import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFunctions } from "firebase-admin/functions";
import { getMessaging } from "firebase-admin/messaging";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onValueCreated } from "firebase-functions/v2/database";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";
import {
    getAlarmTexts,
    getSirenAlarmTexts,
    normalizeAlarmLang,
} from "./alarm-i18n.js";

initializeApp();
const rtdb = getDatabase();
const messaging = getMessaging();
const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineSecret("RESEND_FROM_EMAIL");

function getResendClient() {
    const apiKey = String(resendApiKey.value() || process.env.RESEND_API_KEY || "").trim();
    if (!apiKey) return null;
    return new Resend(apiKey);
}

function getResendFromEmail() {
    return String(
        resendFromEmail.value() ||
        process.env.RESEND_FROM_EMAIL ||
        "onboarding@resend.dev"
    ).trim();
}

const RTDB_INSTANCE = "cleverhaus-petrov-default-rtdb";
const EMAIL_FALLBACK_DELAY_SECONDS = 60;
const ALARM_DEDUPE_MS = 12000;
const ALARM_PUSH_COALESCE_MS = 8000;
// GPIO-wake then stale pin: firmware writes the real edge, then the opposite ~8–25s later.
const PHANTOM_OPPOSITE_MS = 25000;
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

async function resolveNativeTokens(userKey) {
    const key = String(userKey || "").trim();
    if (!key) return [];

    const targets = new Map();
    const consider = (token, platform, updatedAt, deviceId = "", pushTokenKey = "") => {
        const t = String(token || "").trim();
        const p = String(platform || "").toLowerCase();
        const at = Number(updatedAt) || 0;
        if (!t || (p !== "android" && p !== "ios")) return;
        const current = targets.get(t) || {
            token: t,
            platform: p,
            updatedAt: 0,
            deviceIds: new Set(),
            pushTokenKeys: new Set(),
        };
        current.platform = p;
        current.updatedAt = Math.max(current.updatedAt, at);
        if (deviceId) current.deviceIds.add(deviceId);
        if (pushTokenKey) current.pushTokenKeys.add(pushTokenKey);
        targets.set(t, current);
    };

    const [storedSnap, allSnap] = await Promise.all([
        rtdb.ref(`users/${key}/pushTokens`).get(),
        rtdb.ref("nativeDeviceTokens").get(),
    ]);
    const stored = storedSnap.val() || {};
    for (const [pushTokenKey, row] of Object.entries(stored)) {
        if (!row || typeof row !== "object") continue;
        const platform =
            row.platform || (pushTokenKey === "native_android" ? "android" : "");
        consider(row.token, platform, row.createdAt, "", pushTokenKey);
    }
    allSnap.forEach((child) => {
        const row = child.val();
        if (row && String(row.userKey || "").trim() === key) {
            consider(row.token, "android", row.updatedAt, String(child.key || ""));
        }
    });

    const result = Array.from(targets.values())
        .map((target) => ({
            token: target.token,
            platform: target.platform,
            updatedAt: target.updatedAt,
            deviceIds: Array.from(target.deviceIds),
            pushTokenKeys: Array.from(target.pushTokenKeys),
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);

    const newestAndroid = result.find((target) => target.platform === "android");
    const legacyAndroid = stored.native_android || {};
    if (
        newestAndroid &&
        newestAndroid.token !== String(legacyAndroid.token || "").trim()
    ) {
        await rtdb.ref(`users/${key}/pushTokens/native_android`).set({
            token: newestAndroid.token,
            platform: "android",
            createdAt: Date.now(),
        });
        console.log("[sensor-alarm] synced newest native token for", key);
    }
    return result;
}

async function removeDeadNativeToken(userKey, target) {
    const token = String(target?.token || "").trim();
    if (!token) return;
    const removals = [];
    const pushTokensRef = rtdb.ref(`users/${userKey}/pushTokens`);
    removals.push(
        pushTokensRef.get().then(async (snap) => {
            const deletes = [];
            snap.forEach((child) => {
                if (String(child.val()?.token || "").trim() === token) {
                    deletes.push(child.ref.remove());
                }
            });
            await Promise.all(deletes);
        })
    );
    for (const deviceId of target.deviceIds || []) {
        const ref = rtdb.ref(`nativeDeviceTokens/${deviceId}`);
        removals.push(
            ref.get().then((snap) => {
                if (String(snap.val()?.token || "").trim() === token) return ref.remove();
                return null;
            })
        );
    }
    await Promise.all(removals);
    console.warn(
        "[sensor-alarm] removed dead native token",
        userKey,
        (target.deviceIds || []).join(",") || "legacy"
    );
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

async function resolveEmailForUserKey(userKey) {
    const snap = await rtdb
        .ref("userEmailKeys")
        .orderByValue()
        .equalTo(userKey)
        .limitToFirst(1)
        .get();
    let uid = "";
    snap.forEach((child) => {
        if (!uid) uid = String(child.key || "").trim();
    });
    if (uid) {
        try {
            const user = await getAuth().getUser(uid);
            const email = String(user.email || "").trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
        } catch (e) {
            console.warn("[sensor-alarm] auth email lookup failed", userKey, e.message || e);
        }
    }
    return emailFromUserKey(userKey);
}

async function sendAlarmFallbackEmail(userKey, deviceName, bodyText, eventTag, lang) {
    const resend = getResendClient();
    if (!resend) {
        console.warn("[sensor-alarm] email skipped; RESEND_API_KEY missing", userKey, eventTag);
        return false;
    }
    const email = await resolveEmailForUserKey(userKey);
    if (!email) {
        console.warn("[sensor-alarm] email skipped; no email for", userKey, eventTag);
        return false;
    }
    let emailSubject = `Alarm alert - ${deviceName}`;
    let emailIntro =
        "Your phone did not confirm that the alarm was shown. The siren still runs locally.";
    if (!lang) {
        const langSnap = await rtdb.ref(`users/${userKey}/settings/language`).get();
        lang = langSnap.val();
    }
    const isOpen = /open|geöffnet|отвор/i.test(String(bodyText || ""));
    const texts = getAlarmTexts(lang, deviceName, isOpen);
    emailSubject = texts.emailSubject;
    emailIntro = texts.emailIntro;
    const fromAddr = getResendFromEmail();
    try {
        await resend.emails.send({
            from: fromAddr,
            to: [email],
            subject: emailSubject,
            html:
                `<p><strong>${bodyText}</strong></p>` +
                `<p>${emailIntro}</p>`,
        });
    } catch (e) {
        throw e;
    }
    console.log("[sensor-alarm] email fallback sent", userKey, email, eventTag);
    return true;
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

async function rejectPhantomOppositeEdge(userKey, deviceKey, status, historyId, eventCreatedAt) {
    const key = safeEventTagKey(deviceKey);
    const ref = rtdb.ref(`users/${userKey}/settings/lastHistoryEdge/${key}`);
    const now = Number(eventCreatedAt) || Date.now();
    const st = String(status || "").toLowerCase();
    const result = await ref.transaction((current) => {
        const prev = current || {};
        const prevStatus = String(prev.status || "").toLowerCase();
        const prevAt = Number(prev.at) || 0;
        if (
            (prevStatus === "open" || prevStatus === "closed") &&
            prevStatus !== st &&
            Math.abs(now - prevAt) < PHANTOM_OPPOSITE_MS
        ) {
            return;
        }
        return { status: st, at: now, historyId: historyId || "" };
    });
    if (result.committed) return { phantom: false };
    const prev = result.snapshot ? result.snapshot.val() : null;
    return {
        phantom: true,
        prevStatus: String((prev && prev.status) || "").toLowerCase(),
    };
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
        const row = val[key];
        if (
            key === "native_android" ||
            row?.platform === "android" ||
            row?.platform === "ios"
        ) {
            continue;
        }
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

    const nativeTargets = await resolveNativeTokens(userKey);
    let targets = nativeTargets;
    let isNative = targets.length > 0;

    if (!isNative) {
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
                .filter(
                    (entry) =>
                        entry.token &&
                        entry.platform !== "android" &&
                        entry.platform !== "ios" &&
                        entry.key !== "native_android"
                )
                .sort((a, b) => b.createdAt - a.createdAt);
            if (webEntries.length > 0) {
                targets = [{ token: String(webEntries[0].token).trim(), deviceIds: [] }];
            }
        }
    }

    if (targets.length === 0) {
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
    const dedupeTag = safeEventTagKey(eventTag) || safeEventTagKey(collapseKey) || "aura-alarm";

    const buildMessage = (target) => ({
        token: target.token,
        data: {
            title: titleStr,
            body: bodyStr,
            playSound: playFlag,
            eventTag: String(eventTag || ""),
            eventCreatedAt: String(eventCreatedAt || Date.now()),
            userKey: String(userKey || ""),
            skipWeb: isNative ? "1" : "0",
            dedupeTag,
        },
        ...(isNative && target.platform === "android"
            ? {
                  // High-priority display notification so Play Services can wake a standby
                  // phone even when the app process is frozen. TTL must outlast Doze.
                  android: {
                      // Data-only so the app runs while the phone is in standby and can
                      // turn the screen on. A system tray notification arrives, but does not wake.
                      priority: "high",
                      ttl: 60 * 60 * 1000,
                      directBootOk: true,
                  },
              }
            : isNative && target.platform === "ios"
              ? {
                    notification: {
                        title: titleStr,
                        body: bodyStr,
                    },
                    apns: {
                        headers: {
                            "apns-priority": "10",
                            "apns-push-type": "alert",
                        },
                        payload: {
                            aps: {
                                "mutable-content": 1,
                                "interruption-level": "time-sensitive",
                                ...(playSound ? { sound: "default" } : {}),
                            },
                        },
                    },
                }
              : {
                  webpush: { headers: { Urgency: "high" } },
                }),
    });

    const results = await Promise.all(
        targets.map(async (target) => {
            try {
                await messaging.send(buildMessage(target));
                return true;
            } catch (err) {
                if (isNative && isDeadFcmError(err)) {
                    await removeDeadNativeToken(userKey, target).catch((cleanupErr) => {
                        console.warn(
                            "[sensor-alarm] dead token cleanup failed",
                            userKey,
                            cleanupErr.message || cleanupErr
                        );
                    });
                } else {
                    console.warn(
                        "[sensor-alarm] FCM target failed",
                        userKey,
                        isNative ? `native_${target.platform || "unknown"}` : "web",
                        err.message || err
                    );
                }
                return false;
            }
        })
    );
    const sent = results.filter(Boolean).length;
    console.log(
        "[sensor-alarm] FCM targets",
        userKey,
        eventTag,
        isNative ? "native" : "web",
        `sent=${sent}/${targets.length}`
    );
    return sent;
}

async function createAlarmDelivery(
    userKey,
    historyId,
    eventTag,
    deviceName,
    title,
    body,
    createdAt,
    lang,
    includePending = false
) {
    const delivery = {
        userKey,
        historyId,
        eventTag,
        deviceName,
        title,
        body,
        lang: normalizeAlarmLang(lang),
        createdAt,
        state: "pending",
        attempts: 0,
        updatedAt: Date.now(),
    };
    const updates = {};
    if (includePending) {
        updates[`users/${userKey}/pendingAlarmEvents/${eventTag}`] = delivery;
    }
    updates[`users/${userKey}/alarmDeliveries/${eventTag}`] = delivery;
    updates[`alarmDeliveryQueue/${eventTag}`] = delivery;
    await rtdb.ref().update(updates);
    return delivery;
}

async function enqueuePendingAlarmEvent(userKey, eventTag, delivery) {
    if (!userKey || !eventTag || !delivery) return;
    await rtdb.ref(`users/${userKey}/pendingAlarmEvents/${eventTag}`).set(delivery);
}

async function updateAlarmDelivery(userKey, eventTag, values) {
    const update = { ...values, updatedAt: Date.now() };
    const updates = {};
    for (const [key, value] of Object.entries(update)) {
        updates[`users/${userKey}/alarmDeliveries/${eventTag}/${key}`] = value;
        updates[`alarmDeliveryQueue/${eventTag}/${key}`] = value;
    }
    const pendingSnap = await rtdb.ref(`users/${userKey}/pendingAlarmEvents/${eventTag}`).get();
    if (pendingSnap.exists()) {
        for (const [key, value] of Object.entries(update)) {
            updates[`users/${userKey}/pendingAlarmEvents/${eventTag}/${key}`] = value;
        }
    }
    await rtdb.ref().update(updates);
}

async function scheduleAlarmEmailFallback(userKey, eventTag) {
    const queue = getFunctions().taskQueue("emailAlarmFallback");
    await queue.enqueue(
        { userKey, eventTag },
        { scheduleDelaySeconds: EMAIL_FALLBACK_DELAY_SECONDS }
    );
    console.log(
        "[sensor-alarm] email fallback scheduled",
        userKey,
        eventTag,
        `${EMAIL_FALLBACK_DELAY_SECONDS}s`
    );
}

async function processAlarmEmailFallback(userKey, eventTag) {
    const key = String(userKey || "").trim();
    const tag = String(eventTag || "").trim();
    if (!key || !tag) return false;

    const deliveryRef = rtdb.ref(`users/${key}/alarmDeliveries/${tag}`);
    let delivery = (await deliveryRef.get()).val();
    if (!delivery || delivery.ackShownAt || delivery.emailSentAt) {
        console.log("[sensor-alarm] email fallback cancelled by shown ACK", key, tag);
        return false;
    }

    const claimRef = rtdb.ref(
        `users/${key}/settings/emailFallbackClaims/${safeEventTagKey(tag)}`
    );
    const claim = await claimRef.transaction((current) =>
        current ? undefined : { claimedAt: Date.now(), state: "sending" }
    );
    if (!claim.committed) {
        console.log("[sensor-alarm] email fallback dedupe blocked", key, tag);
        return false;
    }

    try {
        delivery = (await deliveryRef.get()).val();
        if (!delivery || delivery.ackShownAt || delivery.emailSentAt) {
            await claimRef.remove();
            console.log("[sensor-alarm] email fallback cancelled by late shown ACK", key, tag);
            return false;
        }
        const sent = await sendAlarmFallbackEmail(
            key,
            delivery.deviceName || "Sensor",
            delivery.body || "Alarm event detected.",
            tag,
            delivery.lang
        );
        if (!sent) {
            throw new Error("Email provider unavailable");
        }
        const sentAt = Date.now();
        const updates = {};
        updates[`users/${key}/pendingAlarmEvents/${tag}`] = null;
        updates[`alarmDeliveryQueue/${tag}`] = null;
        updates[`users/${key}/alarmDeliveries/${tag}/state`] = "email_fallback";
        updates[`users/${key}/alarmDeliveries/${tag}/emailSentAt`] = sentAt;
        updates[`users/${key}/alarmDeliveries/${tag}/updatedAt`] = sentAt;
        updates[`users/${key}/settings/emailSent/${safeEventTagKey(tag)}`] = sentAt;
        updates[
            `users/${key}/settings/emailFallbackClaims/${safeEventTagKey(tag)}/state`
        ] = "sent";
        updates[
            `users/${key}/settings/emailFallbackClaims/${safeEventTagKey(tag)}/sentAt`
        ] = sentAt;
        await rtdb.ref().update(updates);
        return true;
    } catch (e) {
        await Promise.all([
            claimRef.remove().catch(() => {}),
            deliveryRef
                .update({
                    state: "email_retry_pending",
                    emailError: String(e?.message || e).slice(0, 300),
                    updatedAt: Date.now(),
                })
                .catch(() => {}),
        ]);
        throw e;
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

        const safeDeviceId = String(deviceId || deviceName || "sensor").replace(/[.$#[\]/]/g, "_");
        const bounce = await rejectPhantomOppositeEdge(
            userKey,
            safeDeviceId || deviceKey,
            status,
            historyId,
            eventCreatedAt
        );
        if (bounce.phantom) {
            console.log("[sensor-alarm] drop phantom opposite", userKey, deviceName, status, historyId);
            await rtdb.ref(`users/${userKey}/history/${historyId}`).remove();
            if (bounce.prevStatus === "open" || bounce.prevStatus === "closed") {
                await rtdb.ref(`users/${userKey}/devices/${safeDeviceId}`).update({
                    status: bounce.prevStatus === "closed",
                });
            }
            return;
        }
        const [enabledSnap, removedSnap, deviceSnap, langSnap] = await Promise.all([
            rtdb.ref(`users/${userKey}/systemEnabled`).get(),
            rtdb.ref(`users/${userKey}/removedDevices/${safeDeviceId}`).get(),
            rtdb.ref(`users/${userKey}/devices/${safeDeviceId}`).get(),
            rtdb.ref(`users/${userKey}/settings/language`).get(),
        ]);
        if (enabledSnap.val() !== true) {
            console.log("[sensor-alarm] skipped; system off", userKey, deviceName, status);
            return;
        }
        if (removedSnap.exists()) {
            console.log("[sensor-alarm] skipped; device removed", userKey, deviceName, status);
            return;
        }
        const deviceVal = deviceSnap.val();
        if (deviceVal && deviceVal.active === false) {
            console.log("[sensor-alarm] skipped; device paused", userKey, deviceName, status);
            return;
        }
        const displayName =
            (deviceVal && (deviceVal.displayName || deviceVal.deviceName)) || deviceName;
        const alarmText = getAlarmTexts(langSnap.val(), displayName, isOpen);
        const title = alarmText.title;
        const bodyText = alarmText.body;

        // Dedupe only the exact RTDB history event. Legitimate OPEN/CLOSED transitions can
        // happen seconds apart and must each produce an alarm.
        const historyOk = await claimDispatchedHistory(userKey, historyId);
        if (!historyOk) {
            console.log("[sensor-alarm] history already dispatched", userKey, historyId);
            return;
        }

        const delivery = await createAlarmDelivery(
            userKey,
            historyId,
            eventTag,
            displayName,
            title,
            bodyText,
            eventCreatedAt,
            normalizeAlarmLang(langSnap.val()),
            false
        );

        const collapseKey = safeEventTagKey(deviceKey + "-" + status) || "aura-alarm";
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

        await updateAlarmDelivery(userKey, eventTag, {
            state: sent ? "fcm_accepted" : "fcm_send_failed",
            attempts: 1,
            lastAttemptAt: Date.now(),
            fcmAcceptedAt: sent ? Date.now() : null,
        });
        // Email only if the phone does not confirm the alert was shown within 60s.
        // FCM accept alone is not enough: the tray can hold the push while the screen stays off.
        try {
            await scheduleAlarmEmailFallback(userKey, eventTag);
        } catch (e) {
            console.error(
                "[sensor-alarm] email task scheduling failed; scheduler will recover",
                userKey,
                eventTag,
                e.message || e
            );
        }
        console.log(
            "[sensor-alarm]",
            sent ? "FCM accepted; email unless phone shows alert" : "FCM failed; email fallback",
            userKey,
            eventTag
        );
    }
);

export const onSirenAlarmActivated = onValueCreated(
    {
        ref: "/users/{userKey}/sirenEvents/{eventId}",
        instance: RTDB_INSTANCE,
        region: "europe-west1",
        timeoutSeconds: 120,
    },
    async (event) => {
        const entry = event.data.val();
        const userKey = String(event.params.userKey || "").trim();
        const eventId = String(event.params.eventId || "").trim();
        if (!entry || !userKey || !eventId) return;

        const eventCreatedAt = Number(entry.createdAt) || Date.now();
        const eventTag = "siren-" + safeEventTagKey(eventId);
        const langSnap = await rtdb.ref(`users/${userKey}/settings/language`).get();
        const lang = normalizeAlarmLang(langSnap.val());
        const alarmText = getSirenAlarmTexts(lang);

        await createAlarmDelivery(
            userKey,
            eventId,
            eventTag,
            "Siren",
            alarmText.title,
            alarmText.body,
            eventCreatedAt,
            lang,
            true
        );

        const sent = await sendAlarmPushToUser(
            userKey,
            alarmText.title,
            alarmText.body,
            eventTag,
            eventCreatedAt,
            "aura-siren"
        );
        await updateAlarmDelivery(userKey, eventTag, {
            state: sent ? "fcm_accepted" : "fcm_send_failed",
            attempts: 1,
            lastAttemptAt: Date.now(),
            fcmAcceptedAt: sent ? Date.now() : null,
        });

        try {
            await scheduleAlarmEmailFallback(userKey, eventTag);
        } catch (e) {
            console.error(
                "[siren-alarm] email task scheduling failed",
                userKey,
                eventTag,
                e.message || e
            );
        }

        await event.data.ref.remove();
        console.log("[siren-alarm]", userKey, eventTag, "sent:", sent);
    }
);

const OWNER_EMAIL = "office@aurahomesystems.eu";
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
      <li><strong>Sensor quantity:</strong> ${q || "—"}</li>
      <li><strong>Payment method:</strong> ${pm || "—"}</li>
      ${rev ? `<li><strong>Revolut:</strong> ${rev}</li>` : ""}
      <li><strong>Delivery address:</strong> ${addr || "—"}</li>
      ${phone ? `<li><strong>Phone:</strong> ${phone}</li>` : ""}
    </ul>`;
}

function customerDirectOrderConfirmationEmailHtml(data) {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px">
  <p>Hello,</p>
  <p>Your order with <strong>${escapeHtml(SITE_NAME)}</strong> is <strong>confirmed</strong>. Summary:</p>
  ${directOrderSummaryListHtml(data)}
  <p>We will contact you if needed regarding payment and shipping.</p>
  <p>Best regards,<br/><strong>${escapeHtml(SITE_NAME)}</strong></p>
</body>
</html>`;
}

function confirmHtml(success, message, baseUrl) {
    const title = success ? "Confirmed" : "Error";
    const color = success ? "#22c55e" : "#f97373";
    const backLink = baseUrl ? `${baseUrl}/` : "/";
    return `<!DOCTYPE html>
<html lang="en">
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
    <a href="${escapeHtml(backLink)}">← Back to site</a>
  </div>
</body>
</html>`;
}

export const submitInquiry = onRequest(
    { cors: true, secrets: [resendApiKey, resendFromEmail] },
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
                from: getResendFromEmail(),
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
    { cors: true, secrets: [resendApiKey, resendFromEmail] },
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
                    from: getResendFromEmail(),
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
                        from: getResendFromEmail(),
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

export const emailAlarmFallback = onTaskDispatched(
    {
        secrets: [resendApiKey, resendFromEmail],
        retryConfig: {
            maxAttempts: 3,
            minBackoffSeconds: 30,
        },
        rateLimits: {
            maxConcurrentDispatches: 10,
        },
    },
    async (request) => {
        const userKey = String(request.data?.userKey || "").trim();
        const eventTag = String(request.data?.eventTag || "").trim();
        await processAlarmEmailFallback(userKey, eventTag);
    }
);

// FCM acceptance is not delivery. Retry unacknowledged alarms; the task queue sends
// one email after 45 seconds only when no shown ACK exists. This scheduler is also
// a recovery path if task creation or execution was temporarily unavailable.
export const retryUnacknowledgedAlarms = onSchedule(
    {
        schedule: "every 1 minutes",
        region: "europe-west1",
        timeZone: "Europe/Sofia",
        timeoutSeconds: 120,
        secrets: [resendApiKey, resendFromEmail],
    },
    async () => {
        const now = Date.now();
        const snap = await rtdb
            .ref("alarmDeliveryQueue")
            .orderByChild("createdAt")
            .limitToFirst(100)
            .once("value");
        if (!snap.exists()) return;

        const jobs = [];
        snap.forEach((child) => jobs.push({ key: child.key, ...child.val() }));
        for (const job of jobs) {
          try {
            const userKey = String(job.userKey || "").trim();
            const eventTag = String(job.eventTag || job.key || "").trim();
            const createdAt = Number(job.createdAt) || now;
            const lastAttemptAt = Number(job.lastAttemptAt) || 0;
            let attempts = Number(job.attempts) || 0;
            if (!userKey || !eventTag) {
                await rtdb.ref(`alarmDeliveryQueue/${job.key}`).remove();
                continue;
            }

            if (job.ackShownAt || job.state === "ack_shown" || job.state === "email_fallback") {
                await rtdb.ref(`alarmDeliveryQueue/${job.key}`).remove();
                continue;
            }
            if (job.fcmAcceptedAt || job.state === "fcm_accepted" || job.state === "fcm_retried") {
                if (!job.emailSentAt && now - createdAt >= EMAIL_FALLBACK_DELAY_SECONDS * 1000) {
                    await processAlarmEmailFallback(userKey, eventTag);
                } else if (now - createdAt >= 10 * 60 * 1000) {
                    await rtdb.ref(`alarmDeliveryQueue/${job.key}`).remove();
                }
                continue;
            }

            if (now - lastAttemptAt >= 15000 && attempts < 3) {
                const sent = await sendAlarmPushToUser(
                    userKey,
                    job.title || "Aura HomeSystems",
                    job.body || "",
                    eventTag,
                    createdAt,
                    eventTag
                );
                attempts += 1;
                await updateAlarmDelivery(userKey, eventTag, {
                    state: sent ? "fcm_retried" : "fcm_retry_failed",
                    attempts,
                    lastAttemptAt: Date.now(),
                    fcmAcceptedAt: sent ? Date.now() : job.fcmAcceptedAt || null,
                });
                console.log("[alarm-retry]", userKey, eventTag, "attempt", attempts, "sent", sent);
                continue;
            }

            if (attempts >= 3 && now - createdAt >= 90000) {
                await processAlarmEmailFallback(userKey, eventTag);
            }
          } catch (e) {
              console.error("[alarm-retry] job failed", job.key, e.message || e);
          }
        }
    }
);

// Hard caps so RTDB stays small even with many sensors / years of use.
const HISTORY_LIMIT = 20;
const DELIVERY_META_LIMIT = 20;
const SETTINGS_MAP_LIMIT = 40;
const IN_FLIGHT_PROTECT_MS = 2 * 60 * 60 * 1000; // never prune active deliveries younger than 2h
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;

function isTerminalDeliveryState(state) {
    const s = String(state || "");
    return s === "ack_shown" || s === "email_fallback";
}

async function pruneUserHistory(userKey) {
    const histRef = rtdb.ref(`users/${userKey}/history`);
    const snap = await histRef.once("value");
    if (!snap.exists()) return 0;

    const entries = [];
    snap.forEach((child) => {
        entries.push({
            key: child.key,
            timestamp: parseHistoryTimestamp(child.val()),
        });
    });
    if (entries.length <= HISTORY_LIMIT) return 0;

    entries.sort((a, b) => a.timestamp - b.timestamp || a.key.localeCompare(b.key));
    const toDelete = entries.slice(0, entries.length - HISTORY_LIMIT);
    const rootUpdates = {};
    for (const entry of toDelete) {
        rootUpdates[`users/${userKey}/history/${entry.key}`] = null;
        rootUpdates[`users/${userKey}/settings/dispatchedHistory/${entry.key}`] = null;
    }
    await rtdb.ref().update(rootUpdates);
    console.log(`[prune-history] ${userKey}: deleted ${toDelete.length}, kept ${HISTORY_LIMIT}`);
    return toDelete.length;
}

/** Cap /users/{uid}/devices like history — keep newest 20 by lastSeen. */
async function pruneUserDevices(userKey) {
    const devicesRef = rtdb.ref(`users/${userKey}/devices`);
    const snap = await devicesRef.once("value");
    if (!snap.exists()) return 0;

    const entries = [];
    snap.forEach((child) => {
        const val = child.val() || {};
        const lastSeen = Number(val.lastSeen) || 0;
        entries.push({ key: child.key, lastSeen });
    });
    if (entries.length <= HISTORY_LIMIT) return 0;

    entries.sort((a, b) => a.lastSeen - b.lastSeen || a.key.localeCompare(b.key));
    const toDelete = entries.slice(0, entries.length - HISTORY_LIMIT);
    const rootUpdates = {};
    for (const entry of toDelete) {
        rootUpdates[`users/${userKey}/devices/${entry.key}`] = null;
        rootUpdates[`users/${userKey}/settings/alarmGate/${entry.key}`] = null;
        rootUpdates[`users/${userKey}/settings/coalescedPush/${safeEventTagKey(entry.key + "_open")}`] =
            null;
        rootUpdates[`users/${userKey}/settings/coalescedPush/${safeEventTagKey(entry.key + "_closed")}`] =
            null;
    }
    await rtdb.ref().update(rootUpdates);
    console.log(`[prune-devices] ${userKey}: deleted ${toDelete.length}, kept ${HISTORY_LIMIT}`);
    return toDelete.length;
}

async function pruneTimestampKeyedMap(userKey, relativePath, limit, maxAgeMs = 0) {
    const snap = await rtdb.ref(`users/${userKey}/${relativePath}`).once("value");
    if (!snap.exists()) return 0;
    const now = Date.now();
    const rows = [];
    snap.forEach((child) => {
        const val = child.val();
        let at = 0;
        if (typeof val === "number") at = val;
        else if (val && typeof val === "object") {
            at = Number(val.sentAt || val.claimedAt || val.at || val.updatedAt || val.createdAt) || 0;
        }
        rows.push({ key: child.key, at });
    });
    if (!rows.length) return 0;
    rows.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
    const updates = {};
    let deleted = 0;
    if (maxAgeMs > 0) {
        for (const row of rows) {
            if (row.at > 0 && now - row.at > maxAgeMs) {
                updates[`users/${userKey}/${relativePath}/${row.key}`] = null;
                deleted++;
            }
        }
    }
    const remaining = rows.filter((row) => !updates[`users/${userKey}/${relativePath}/${row.key}`]);
    if (remaining.length > limit) {
        const expired = remaining.slice(0, remaining.length - limit);
        for (const row of expired) {
            updates[`users/${userKey}/${relativePath}/${row.key}`] = null;
            deleted++;
        }
    }
    if (deleted > 0) await rtdb.ref().update(updates);
    return deleted;
}

async function pruneUserDeliveryMetadata(userKey) {
    const now = Date.now();
    const updates = {};
    let deleted = 0;

    const deliverySnap = await rtdb.ref(`users/${userKey}/alarmDeliveries`).once("value");
    const keepTags = new Set();
    if (deliverySnap.exists()) {
        const rows = [];
        deliverySnap.forEach((child) => {
            const value = child.val() || {};
            const createdAt = Number(value.createdAt || value.updatedAt || 0) || 0;
            const state = String(value.state || "");
            const inFlight =
                !isTerminalDeliveryState(state) &&
                createdAt > 0 &&
                now - createdAt < IN_FLIGHT_PROTECT_MS;
            rows.push({
                eventTag: child.key,
                historyId: String(value.historyId || ""),
                at: Number(value.ackShownAt || value.emailSentAt || value.updatedAt || value.createdAt) || 0,
                inFlight,
                state,
            });
        });
        rows.sort((a, b) => a.at - b.at || a.eventTag.localeCompare(b.eventTag));

        const protectedRows = rows.filter((r) => r.inFlight);
        const prunable = rows.filter((r) => !r.inFlight);
        const keepPrunable = prunable.slice(-DELIVERY_META_LIMIT);
        const drop = prunable.slice(0, Math.max(0, prunable.length - DELIVERY_META_LIMIT));

        for (const row of protectedRows.concat(keepPrunable)) {
            keepTags.add(row.eventTag);
        }
        for (const item of drop) {
            updates[`users/${userKey}/alarmDeliveries/${item.eventTag}`] = null;
            updates[`users/${userKey}/pushAcks/${item.eventTag}`] = null;
            updates[`users/${userKey}/pendingAlarmEvents/${item.eventTag}`] = null;
            updates[`alarmDeliveryQueue/${item.eventTag}`] = null;
            updates[`users/${userKey}/settings/emailSent/${safeEventTagKey(item.eventTag)}`] = null;
            updates[`users/${userKey}/settings/pushSendLock/${safeEventTagKey(item.eventTag)}`] = null;
            updates[
                `users/${userKey}/settings/emailFallbackClaims/${safeEventTagKey(item.eventTag)}`
            ] = null;
            if (item.historyId) {
                updates[`users/${userKey}/settings/dispatchedHistory/${item.historyId}`] = null;
            }
            deleted++;
        }
    }

    // Orphan pushAcks / pending events not tied to kept deliveries.
    const ackSnap = await rtdb.ref(`users/${userKey}/pushAcks`).once("value");
    if (ackSnap.exists()) {
        ackSnap.forEach((child) => {
            if (!keepTags.has(child.key)) {
                updates[`users/${userKey}/pushAcks/${child.key}`] = null;
                deleted++;
            }
        });
    }
    const pendingSnap = await rtdb.ref(`users/${userKey}/pendingAlarmEvents`).once("value");
    if (pendingSnap.exists()) {
        pendingSnap.forEach((child) => {
            const createdAt = Number((child.val() || {}).createdAt) || 0;
            const stale = createdAt > 0 && now - createdAt > STALE_PENDING_MS;
            if (!keepTags.has(child.key) || stale) {
                updates[`users/${userKey}/pendingAlarmEvents/${child.key}`] = null;
                updates[`alarmDeliveryQueue/${child.key}`] = null;
                deleted++;
            }
        });
    }

    if (deleted > 0) await rtdb.ref().update(updates);

    // Cap timestamped settings maps (dedupe locks, etc.).
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/dispatchedHistory",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/pushSendLock",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/emailSent",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/dispatchedEventTags",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/emailFallbackClaims",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/coalescedPush",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );
    deleted += await pruneTimestampKeyedMap(
        userKey,
        "settings/alarmGate",
        SETTINGS_MAP_LIMIT,
        STALE_PENDING_MS
    );

    if (deleted > 0) {
        console.log(`[prune-meta] ${userKey}: cleaned ${deleted} nodes`);
    }
    return deleted;
}

async function pruneUserData(userKey) {
    await pruneUserHistory(userKey);
    await pruneUserDevices(userKey);
    await pruneUserDeliveryMetadata(userKey);
}

// Enforce limits immediately after every newly created sensor event.
export const pruneHistoryOnCreate = onValueCreated(
    {
        ref: "/users/{userKey}/history/{historyId}",
        instance: RTDB_INSTANCE,
        region: "europe-west1",
        timeoutSeconds: 60,
    },
    async (event) => {
        const userKey = String(event.params.userKey || "").trim();
        if (!userKey) return;
        await pruneUserData(userKey);
    }
);

// Periodic safety pass for all users (also cleans already-bloated accounts).
export const pruneHistory = onSchedule(
    {
        schedule: "every 6 hours",
        region: "europe-west1",
        timeZone: "Europe/Sofia",
    },
    async () => {
        try {
            const usersSnap = await rtdb.ref("users").once("value");
            if (!usersSnap.exists()) return;
            const users = usersSnap.val();
            for (const userKey of Object.keys(users)) {
                await pruneUserData(userKey);
            }
        } catch (e) {
            console.error("[prune-history] error", e.message || e);
        }
    }
);

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
