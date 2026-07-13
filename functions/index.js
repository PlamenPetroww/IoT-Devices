import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onValueCreated } from "firebase-functions/v2/database";
import { Resend } from "resend";
import crypto from "crypto";

initializeApp();
const rtdb = getDatabase();
const messaging = getMessaging();

function getResendClient() {
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    if (!apiKey) return null;
    return new Resend(apiKey);
}

const RTDB_INSTANCE = "cleverhaus-petrov-default-rtdb";
const ALARM_DEDUPE_MS = 45000;
const ALARM_PUSH_COALESCE_MS = 20000;
const RENDER_HEALTH_URL =
    process.env.RENDER_HEALTH_URL || "https://cleverhaus.onrender.com/api/health";

function isDeadFcmError(err) {
    const code = String(err?.code || "");
    const msg = String(err?.message || err || "");
    return (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        /unregistered|not.?registered|entity was not found|Requested entity was not found/i.test(msg)
    );
}

async function resolveNativeAndroidToken(userKey) {
    const key = String(userKey || "").trim();
    if (!key) return "";

    const snap = await rtdb.ref(`users/${key}/pushTokens/native_android`).get();
    const stored = snap.val()?.token ? String(snap.val().token).trim() : "";
    let latest = stored;
    let latestAt = Number(snap.val()?.createdAt) || 0;

    const consider = (token, updatedAt) => {
        const t = String(token || "").trim();
        const at = Number(updatedAt) || 0;
        if (!t) return;
        if (!latest || at >= latestAt) {
            latest = t;
            latestAt = at;
        }
    };

    const deviceIdSnap = await rtdb.ref(`users/${key}/settings/nativeDeviceId`).get();
    const deviceId = deviceIdSnap.val() ? String(deviceIdSnap.val()).trim() : "";
    if (deviceId) {
        const devSnap = await rtdb.ref(`nativeDeviceTokens/${deviceId}`).get();
        const row = devSnap.val();
        if (row) consider(row.token, row.updatedAt);
    }

    const allSnap = await rtdb.ref("nativeDeviceTokens").get();
    allSnap.forEach((child) => {
        const row = child.val();
        if (row && String(row.userKey || "").trim() === key) {
            consider(row.token, row.updatedAt);
        }
    });

    if (latest && latest !== stored) {
        await rtdb.ref(`users/${key}/pushTokens/native_android`).set({
            token: latest,
            platform: "android",
            createdAt: Date.now(),
        });
        console.log("[sensor-alarm] synced native token for", key);
    }

    return latest;
}

function emailFromUserKey(userKey) {
    const marker = "_at_";
    const at = userKey.indexOf(marker);
    if (at <= 0) return "";
    const local = userKey.slice(0, at).replace(/-/g, ".");
    const domain = userKey.slice(at + marker.length).replace(/-/g, ".");
    const email = `${local}@${domain}`;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

async function claimEmailSent(userKey, eventTag, bodyText) {
    const ref = rtdb.ref(`users/${userKey}/settings/emailSent/${safeEventTagKey(eventTag)}`);
    const now = Date.now();
    const result = await ref.transaction((current) => {
        const prev = Number(current) || 0;
        if (prev && now - prev < ALARM_DEDUPE_MS) {
            return;
        }
        return now;
    });
    if (!result.committed) {
        return false;
    }
    const bodyRef = rtdb.ref(`users/${userKey}/settings/lastBodyEmail`);
    const bodyKey = String(bodyText || "").trim();
    const bodyResult = await bodyRef.transaction((current) => {
        const prev = current || {};
        const prevBody = String(prev.body || "");
        const prevAt = Number(prev.at) || 0;
        if (prevBody === bodyKey && now - prevAt < ALARM_DEDUPE_MS) {
            return;
        }
        return { body: bodyKey, at: now };
    });
    return !!bodyResult.committed;
}

async function sendAlarmFallbackEmail(userKey, deviceName, bodyText, eventTag) {
    const ok = await claimEmailSent(userKey, eventTag, bodyText);
    if (!ok) {
        console.log("[sensor-alarm] email dedupe blocked", userKey, eventTag);
        return;
    }
    const resend = getResendClient();
    if (!resend) {
        console.warn("[sensor-alarm] email skipped; RESEND_API_KEY missing", userKey, eventTag);
        return;
    }
    const email = emailFromUserKey(userKey);
    if (!email) {
        console.warn("[sensor-alarm] email skipped; no email for", userKey, eventTag);
        return;
    }
    const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    await resend.emails.send({
        from: fromAddr,
        to: [email],
        subject: `Alarm alert - ${deviceName}`,
        html:
            `<p><strong>${bodyText}</strong></p>` +
            `<p>Push notification could not be delivered to your phone (no app token or delivery failed).</p>`,
    });
    await rtdb.ref(`users/${userKey}/pendingAlarmEvents/${eventTag}`).remove();
    console.log("[sensor-alarm] email fallback sent", userKey, email, eventTag);
}

function safeDeviceKey(deviceId, deviceName) {
    return String(deviceId || deviceName || "sensor")
        .trim()
        .toLowerCase()
        .replace(/[.$#[\]/]/g, "_");
}

function alarmDeviceKey(deviceName, deviceId) {
    const name = String(deviceName || deviceId || "sensor").trim();
    return safeDeviceKey("", name);
}

function normalizeAlarmBodyKey(deviceName, status) {
    const name = String(deviceName || "Sensor")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    const st = String(status || "").toLowerCase() === "open" ? "open" : "closed";
    return `${name}|${st}`;
}

async function claimCoalescedDevicePush(userKey, deviceKey, status) {
    const ref = rtdb.ref(
        `users/${userKey}/settings/coalescedPush/${safeEventTagKey(deviceKey + "_" + status)}`
    );
    const now = Date.now();
    const result = await ref.transaction((current) => {
        const prev = Number(current) || 0;
        if (prev && now - prev < ALARM_PUSH_COALESCE_MS) {
            return;
        }
        return now;
    });
    return !!result.committed;
}

async function claimRecentBodyPush(userKey, bodyText) {
    const ref = rtdb.ref(`users/${userKey}/settings/lastBodyPush`);
    const now = Date.now();
    const bodyKey = String(bodyText || "").trim();
    const result = await ref.transaction((current) => {
        const prev = current || {};
        const prevBody = String(prev.body || "");
        const prevAt = Number(prev.at) || 0;
        if (prevBody === bodyKey && now - prevAt < ALARM_DEDUPE_MS) {
            return;
        }
        return { body: bodyKey, at: now };
    });
    return !!result.committed;
}

async function claimAlarmGate(userKey, deviceKey, status, historyId) {
    const ref = rtdb.ref(`users/${userKey}/settings/alarmGate/${deviceKey}`);
    const now = Date.now();
    const result = await ref.transaction((current) => {
        const prev = current || {};
        const prevAt = Number(prev.at) || 0;
        const prevStatus = String(prev.status || "");
        if (prevStatus === status && now - prevAt < ALARM_DEDUPE_MS) {
            return;
        }
        return { status, at: now, historyId: historyId || "" };
    });
    return !!result.committed;
}

function safeEventTagKey(eventTag) {
    return String(eventTag || "")
        .trim()
        .replace(/[.$#[\]/]/g, "_");
}

async function claimDispatchedEventTag(userKey, eventTag) {
    const ref = rtdb.ref(`users/${userKey}/settings/dispatchedEventTags/${safeEventTagKey(eventTag)}`);
    const now = Date.now();
    const result = await ref.transaction((current) => {
        const prev = Number(current) || 0;
        if (prev && now - prev < ALARM_DEDUPE_MS) {
            return;
        }
        return now;
    });
    return !!result.committed;
}

async function claimDispatchedHistory(userKey, historyId) {
    if (!historyId) return true;
    const ref = rtdb.ref(`users/${userKey}/settings/dispatchedHistory/${historyId}`);
    const result = await ref.transaction((current) => (current ? undefined : Date.now()));
    return !!result.committed;
}

function parseHistoryTimestamp(entry) {
    const ts = entry && entry.timestamp;
    if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) return ts;
    if (typeof ts === "string" && /^\d+$/.test(ts)) return Number(ts);
    return 0;
}

async function purgeWebPushTokens(userKey) {
    const snap = await rtdb.ref(`users/${userKey}/pushTokens`).get();
    const val = snap.val();
    if (!val || typeof val !== "object") return;
    const removes = [];
    for (const key of Object.keys(val)) {
        if (key === "native_android") continue;
        removes.push(rtdb.ref(`users/${userKey}/pushTokens/${key}`).remove());
    }
    if (removes.length) {
        await Promise.all(removes);
        console.log("[sensor-alarm] removed web push tokens", userKey, removes.length);
    }
}

async function claimPushSendLock(userKey, eventTag) {
    const ref = rtdb.ref(`users/${userKey}/settings/pushSendLock/${safeEventTagKey(eventTag)}`);
    const now = Date.now();
    const result = await ref.transaction((current) => {
        const prev = Number(current) || 0;
        if (prev && now - prev < ALARM_DEDUPE_MS) {
            return;
        }
        return now;
    });
    return !!result.committed;
}

async function sendAlarmPushToUser(userKey, title, body, eventTag, eventCreatedAt, collapseKey) {
    const soundSnap = await rtdb.ref(`users/${userKey}/settings/alertSoundEnabled`).get();
    const playSound = soundSnap.val() !== false;
    const playFlag = playSound ? "1" : "0";

    let targetToken = await resolveNativeAndroidToken(userKey);
    let isNative = Boolean(targetToken);

    if (!targetToken) {
        const snap = await rtdb.ref(`users/${userKey}/pushTokens`).get();
        const val = snap.val();
        if (val && typeof val === "object") {
            const webEntries = Object.keys(val)
                .map((key) => ({
                    key,
                    token: val[key] && val[key].token,
                    platform: (val[key] && val[key].platform) || "web",
                    createdAt: Number((val[key] && val[key].createdAt) || 0),
                }))
                .filter((entry) => entry.token && entry.platform !== "android" && entry.key !== "native_android")
                .sort((a, b) => b.createdAt - a.createdAt);
            if (webEntries.length > 0) {
                targetToken = String(webEntries[0].token).trim();
            }
        }
    }

    if (!targetToken) {
        console.warn("[sensor-alarm] no push token", userKey, eventTag);
        return 0;
    }

    if (isNative) {
        await purgeWebPushTokens(userKey);
    }

    const sendLockOk = await claimPushSendLock(userKey, eventTag);
    if (!sendLockOk) {
        console.log("[sensor-alarm] push send lock blocked", userKey, eventTag);
        return 0;
    }

    const titleStr = String(title || "Aura HomeSystems");
    const bodyStr = String(body || "");
    const collapse = safeEventTagKey(collapseKey || eventTag) || "aura-alarm";

    const buildMessage = (token) => ({
        token,
        data: {
            title: titleStr,
            body: bodyStr,
            playSound: playFlag,
            eventTag: String(eventTag || ""),
            eventCreatedAt: String(eventCreatedAt || Date.now()),
            userKey: String(userKey || ""),
            skipWeb: isNative ? "1" : "0",
            dedupeTag: collapse,
        },
        ...(isNative
            ? {
                  android: {
                      priority: "high",
                      ttl: 86400000,
                      collapseKey: collapse,
                  },
              }
            : {
                  webpush: { headers: { Urgency: "high" } },
              }),
    });

    try {
        await messaging.send(buildMessage(targetToken));
        console.log("[sensor-alarm] FCM sent once", userKey, eventTag, isNative ? "native" : "web");
        return 1;
    } catch (err) {
        if (isNative && isDeadFcmError(err)) {
            console.warn("[sensor-alarm] dead token; refreshing", userKey, err.message || err);
            await rtdb.ref(`users/${userKey}/pushTokens/native_android`).remove().catch(() => {});
            const retryToken = await resolveNativeAndroidToken(userKey);
            if (retryToken && retryToken !== targetToken) {
                try {
                    await messaging.send(buildMessage(retryToken));
                    console.log("[sensor-alarm] FCM sent once after token refresh", userKey, eventTag);
                    return 1;
                } catch (retryErr) {
                    console.warn(
                        "[sensor-alarm] FCM retry failed",
                        userKey,
                        retryErr.message || retryErr
                    );
                }
            }
        }
        console.warn("[sensor-alarm] FCM failed", userKey, isNative ? "native_android" : "web", err.message || err);
        return 0;
    }
}

export const onSensorHistoryAlarm = onValueCreated(
    {
        ref: "/users/{userKey}/history/{historyId}",
        instance: RTDB_INSTANCE,
        region: "europe-west1",
        timeoutSeconds: 120,
    },
    async (event) => {
        const entry = event.data.val();
        if (!entry || entry.fromServerApi) return;
        const status = String(entry.status || "").toLowerCase();
        if (status !== "open" && status !== "closed") return;

        const userKey = String(event.params.userKey || "").trim();
        if (!userKey) return;

        const historyId = String(event.params.historyId || "").trim();
        const deviceId = String(entry.deviceId || entry.deviceName || "sensor").trim();
        const deviceName = String(entry.deviceName || deviceId || "Sensor").trim();
        const isOpen = status === "open";
        const eventCreatedAt = parseHistoryTimestamp(entry) || Date.now();
        const deviceKey = alarmDeviceKey(deviceName, deviceId);
        const eventTag = "cf-" + safeEventTagKey(historyId || deviceKey + "-" + status + "-" + eventCreatedAt);
        const title = "Aura HomeSystems";
        const bodyText = isOpen ? `${deviceName} was opened.` : `${deviceName} was closed.`;

        const enabledSnap = await rtdb.ref(`users/${userKey}/systemEnabled`).get();
        if (enabledSnap.val() !== true) {
            console.log("[sensor-alarm] skipped; system off", userKey, deviceName, status);
            return;
        }

        const gateOk = await claimAlarmGate(userKey, deviceKey, status, historyId);
        if (!gateOk) {
            console.log("[sensor-alarm] gate blocked duplicate", userKey, deviceName, status, historyId);
            return;
        }

        const historyOk = await claimDispatchedHistory(userKey, historyId);
        if (!historyOk) {
            console.log("[sensor-alarm] history already dispatched", userKey, historyId);
            return;
        }

        const collapseKey = safeEventTagKey(deviceKey + "-" + status) || "aura-alarm";
        const coalesceOk = await claimCoalescedDevicePush(userKey, deviceKey, status);
        if (!coalesceOk) {
            console.log("[sensor-alarm] coalesce blocked duplicate push", userKey, deviceName, status, historyId);
            return;
        }

        const sent = await sendAlarmPushToUser(
            userKey,
            title,
            bodyText,
            eventTag,
            eventCreatedAt,
            collapseKey
        );
        console.log(
            "[sensor-alarm]",
            userKey,
            deviceName,
            status,
            "historyId:",
            historyId,
            "eventTag:",
            eventTag,
            "sent:",
            sent
        );

        if (sent === 0) {
            await rtdb.ref(`users/${userKey}/pendingAlarmEvents/${eventTag}`).set({
                eventTag,
                createdAt: eventCreatedAt,
                title,
                body: bodyText,
                userKey,
            });
            await sendAlarmFallbackEmail(userKey, deviceName, bodyText, eventTag);
            return;
        }

        await rtdb.ref(`users/${userKey}/pendingAlarmEvents/${eventTag}`).remove().catch(() => {});
        console.log("[sensor-alarm] push ok; no email backup", userKey, eventTag);
    }
);

const OWNER_EMAIL = "solutions.petrov@gmail.com";
const FROM_EMAIL = "onboarding@resend.dev";
const SITE_NAME = "Aura HomeSystems";
const PENDING_PATH = "pendingInquiries";

function randomToken() {
    return crypto.randomBytes(24).toString("hex");
}

function escapeHtml(s) {
    if (typeof s !== "string") return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function directOrderSummaryListHtml(data) {
    const q = escapeHtml((data.quantity || "").toString().trim());
    const pm = escapeHtml((data.paymentMethod || "").toString().trim());
    const addr = escapeHtml((data.deliveryAddress || "").toString().trim());
    const phone = escapeHtml((data.phone || "").toString().trim());
    const rev = data.revolutId ? escapeHtml(String(data.revolutId).trim()) : "";
    return `
    <ul style="margin:12px 0;padding-left:20px;line-height:1.6">
      <li><strong>Брой сензори:</strong> ${q || "—"}</li>
      <li><strong>Начин на плащане:</strong> ${pm || "—"}</li>
      ${rev ? `<li><strong>Revolut:</strong> ${rev}</li>` : ""}
      <li><strong>Адрес за доставка:</strong> ${addr || "—"}</li>
      ${phone ? `<li><strong>Телефон:</strong> ${phone}</li>` : ""}
    </ul>`;
}

function customerDirectOrderConfirmationEmailHtml(data) {
    return `<!DOCTYPE html>
<html lang="bg">
<head><meta charset="UTF-8" /></head>
<body style="font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px">
  <p>Здравейте,</p>
  <p>Поръчката ви до <strong>${escapeHtml(SITE_NAME)}</strong> е <strong>потвърдена</strong>. Резюме:</p>
  ${directOrderSummaryListHtml(data)}
  <p>Ще се свържем с вас при необходимост относно плащане и изпращане.</p>
  <p>Поздрави,<br/><strong>${escapeHtml(SITE_NAME)}</strong></p>
</body>
</html>`;
}

function confirmHtml(success, message, baseUrl) {
    const title = success ? "Потвърдено" : "Грешка";
    const color = success ? "#22c55e" : "#f97373";
    const backLink = baseUrl ? `${baseUrl}/` : "/";
    return `<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} – Aura HomeSystems</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #020617; color: #e5e7eb; min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 20px; }
    .box { max-width: 420px; padding: 32px; background: rgba(15,23,42,0.98); border-radius: 16px; border: 1px solid rgba(148,163,184,0.35); text-align: center; }
    h1 { margin: 0 0 16px; font-size: 1.4rem; color: ${color}; }
    p { margin: 0 0 24px; color: #9ca3af; line-height: 1.6; }
    a { color: #4ade80; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="${escapeHtml(backLink)}">← Обратно към сайта</a>
  </div>
</body>
</html>`;
}

export const submitInquiry = onRequest(
    { cors: true },
    async (req, res) => {
        if (req.method !== "POST") {
            res.status(405).json({ error: "Method not allowed" });
            return;
        }
        const { email, subject, message, phone, sensorsTotal, sensorsWindow, sensorsDoor, deliveryAddress, orderType, quantity, paymentMethod, revolutId, baseUrl } = req.body || {};
        if (!email || !subject || !message) {
            res.status(400).json({ error: "Missing email, subject or message" });
            return;
        }
        const token = randomToken();
        const base = (baseUrl || "").replace(/\/$/, "");
        const confirmUrl = `${base}/confirm-inquiry.html?t=${token}`;

        const payload = {
            email: String(email).trim(),
            subject: String(subject).trim(),
            message: String(message).trim(),
            phone: phone ? String(phone).trim() : "",
            sensorsTotal: sensorsTotal !== undefined ? String(sensorsTotal).trim() : "",
            sensorsWindow: sensorsWindow !== undefined ? String(sensorsWindow).trim() : "",
            sensorsDoor: sensorsDoor !== undefined ? String(sensorsDoor).trim() : "",
            deliveryAddress: deliveryAddress ? String(deliveryAddress).trim() : "",
            orderType: orderType ? String(orderType).trim() : "",
            quantity: quantity !== undefined ? String(quantity).trim() : "",
            paymentMethod: paymentMethod ? String(paymentMethod).trim() : "",
            revolutId: revolutId ? String(revolutId).trim() : "",
            baseUrl: base ? String(base).trim() : "",
            verified: false,
            createdAt: new Date().toISOString(),
        };

        try {
            await rtdb.ref(`${PENDING_PATH}/${token}`).set(payload);
        } catch (e) {
            console.error("RTDB write error", e);
            res.status(500).json({ error: "Failed to save inquiry" });
            return;
        }

        const resend = getResendClient();
        if (!resend) {
            res.status(500).json({ error: "RESEND_API_KEY not configured" });
            return;
        }

        const isDirect = String(orderType || "").trim() === "direct";
        const orderPendingBlock = isDirect
            ? `<p><strong>Вашата директна поръчка</strong> (ще влезе в сила след потвърждение на имейла):</p>${directOrderSummaryListHtml(payload)}`
            : "";

        try {
            await resend.emails.send({
                from: FROM_EMAIL,
                to: email.trim(),
                subject: isDirect
                    ? `Потвърдете поръчката си – ${SITE_NAME}`
                    : `Потвърдете запитването си – ${SITE_NAME}`,
                html: `
                  <p>Здравейте,</p>
                  <p>Получихме вашето ${isDirect ? "поръчка" : "запитване"} до ${SITE_NAME}. Моля, потвърдете имейла си като кликнете на линка по-долу:</p>
                  <p><a href="${confirmUrl}">${confirmUrl}</a></p>
                  ${orderPendingBlock}
                  <p>След потвърждението ние ще получим вашето съобщение${isDirect ? " и ще обработим поръчката" : ""} и ще се свържем при нужда.</p>
                  <p>Ако не сте изпращали ${isDirect ? "поръчка" : "запитване"}, просто игнорирайте този имейл.</p>
                  <p>Поздрави,<br/>${SITE_NAME}</p>
                `,
            });
        } catch (e) {
            console.error("Resend send error", e);
            res.status(500).json({ error: "Failed to send verification email" });
            return;
        }

        res.set("Access-Control-Allow-Origin", "*");
        res.status(200).json({ success: true, token });
    }
);

export const confirmInquiry = onRequest(
    { cors: true },
    async (req, res) => {
        const token = (req.query.t || req.query.token || "").toString().trim();
        if (!token) {
            res.status(400).send(confirmHtml(false, "Липсва код за потвърждение.", null));
            return;
        }

        const ref = rtdb.ref(`${PENDING_PATH}/${token}`);
        let snapshot;
        try {
            snapshot = await ref.once("value");
        } catch (e) {
            console.error("RTDB read error", e);
            res.status(500).send(confirmHtml(false, "Възникна грешка. Опитайте отново по-късно.", null));
            return;
        }

        const data = snapshot.val();
        if (!data) {
            res.status(404).send(confirmHtml(false, "Невалиден или изтекла връзка за потвърждение.", null));
            return;
        }

        if (data.verified === true) {
            res.status(200).send(confirmHtml(true, "Запитването вече е било потвърдено.", data.baseUrl || null));
            return;
        }

        try {
            await ref.update({ verified: true, verifiedAt: new Date().toISOString() });
        } catch (e) {
            console.error("RTDB update error", e);
            res.status(500).send(confirmHtml(false, "Възникна грешка при потвърждението.", data.baseUrl || null));
            return;
        }

        const resend = getResendClient();
        if (resend) {
            try {
                await resend.emails.send({
                    from: FROM_EMAIL,
                    to: OWNER_EMAIL,
                    replyTo: data.email,
                    subject: `[Потвърдено запитване] ${data.subject}`,
                    html: `
                      <p><strong>От:</strong> ${escapeHtml(data.email)}</p>
                      ${data.phone ? `<p><strong>Телефон:</strong> ${escapeHtml(data.phone)}</p>` : ""}
                      <p><strong>Заглавие:</strong> ${escapeHtml(data.subject)}</p>
                      ${(data.orderType === "direct" && data.quantity) ? `<p><strong>Поръчка:</strong> ${escapeHtml(data.quantity)} бр. | Плащане: ${escapeHtml(data.paymentMethod || "")} | Адрес: ${escapeHtml(data.deliveryAddress || "")}</p>` : ""}
                      ${(data.orderType === "direct" && data.paymentMethod === "revolut" && data.revolutId) ? `<p><strong>Revolut:</strong> ${escapeHtml(data.revolutId)}</p>` : ""}
                      ${(!data.orderType && data.sensorsTotal) ? `<p><strong>Сензори (общо):</strong> ${escapeHtml(data.sensorsTotal)}</p>` : ""}
                      ${(!data.orderType && (data.sensorsWindow || data.sensorsDoor)) ? `<p><strong>Поръчка:</strong> прозорци ${escapeHtml(data.sensorsWindow || "0")}, врати ${escapeHtml(data.sensorsDoor || "0")}</p>` : ""}
                      ${data.deliveryAddress && data.orderType !== "direct" ? `<p><strong>Адрес за доставка:</strong> ${escapeHtml(data.deliveryAddress)}</p>` : ""}
                      <hr/>
                      <p>${escapeHtml(data.message).replace(/\n/g, "<br/>")}</p>
                    `,
                });
            } catch (e) {
                console.error("Resend forward error", e);
            }
            if (data.orderType === "direct" && data.email) {
                try {
                    await resend.emails.send({
                        from: FROM_EMAIL,
                        to: String(data.email).trim(),
                        subject: `Вашата поръчка е потвърдена – ${SITE_NAME}`,
                        html: customerDirectOrderConfirmationEmailHtml(data),
                    });
                } catch (e) {
                    console.error("Resend customer order confirmation error", e);
                }
            }
        }

        res.set("Access-Control-Allow-Origin", "*");
        res.status(200).send(confirmHtml(true, "Благодарим! Запитването ви е потвърдено. Ще получите отговор скоро на посочения имейл.", data.baseUrl || null));
    }
);

/** Render free tier sleeps when idle; internal setInterval cannot wake a stopped instance. */
export const keepRenderAwake = onSchedule(
    {
        schedule: "every 10 minutes",
        region: "europe-west1",
        timeZone: "Europe/Sofia",
    },
    async () => {
        try {
            const res = await fetch(RENDER_HEALTH_URL, {
                signal: AbortSignal.timeout(25000),
            });
            const body = await res.text();
            console.log("[keep-render-awake]", res.status, body.slice(0, 160));
        } catch (e) {
            console.warn("[keep-render-awake] failed", e.message || e);
        }
    }
);
