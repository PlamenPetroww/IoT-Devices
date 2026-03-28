import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { onRequest } from "firebase-functions/v2/https";
import { Resend } from "resend";
import crypto from "crypto";

initializeApp();
const rtdb = getDatabase();
const resend = new Resend(process.env.RESEND_API_KEY || "");

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

        if (!resend.ApiKey) {
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

        if (resend.ApiKey) {
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
