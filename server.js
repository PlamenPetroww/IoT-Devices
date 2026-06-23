const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/** Local dev: optional `.env` in project root (already in .gitignore). Does not override real env vars. */
function loadEnvFile() {
  try {
    const p = path.join(__dirname, ".env");
    if (!fs.existsSync(p)) return;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split(/\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) {
    console.warn("Could not read .env:", e.message);
  }
}
loadEnvFile();

const REVOLUT_API_VERSION = process.env.REVOLUT_API_VERSION || "2024-09-01";

// Render free tier sleeps after ~15 min idle → 30-60 s push delay on the next sensor event.
// Self-ping keeps the instance warm. RENDER_EXTERNAL_URL is set automatically by Render.
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || "";
if (/^https?:\/\//.test(KEEP_ALIVE_URL)) {
  const pingMod = KEEP_ALIVE_URL.startsWith("https") ? https : http;
  setInterval(() => {
    pingMod
      .get(KEEP_ALIVE_URL, (r) => r.resume())
      .on("error", () => {});
  }, 10 * 60 * 1000);
  console.log("[keep-alive] Pinging", KEEP_ALIVE_URL, "every 10 min");
}

/** Strip accidental "sandbox " prefix from pasted Revolut keys. */
function sanitizeRevolutKey(key) {
  if (!key || typeof key !== "string") return "";
  return key.trim().replace(/^sandbox\s+/i, "");
}

function getRevolutSecretKey() {
  return sanitizeRevolutKey(process.env.REVOLUT_API_SECRET_KEY);
}

function getRevolutPublicKey() {
  return sanitizeRevolutKey(process.env.REVOLUT_API_PUBLIC_KEY);
}

function loadShippingZones() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "shipping.json"), "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.zones) ? j.zones : [];
  } catch (e) {
    return [];
  }
}

const UNIT_PRICE_EUR = 59;
const BUNDLES = { 1: 59, 3: 159, 5: 249 };
const BGN_TO_EUR = 1.95583;

function getTotalForQtyOrder(q) {
  const n = parseInt(q, 10);
  if (!Number.isFinite(n) || n < 1 || n > 99) return null;
  if (BUNDLES[n] !== undefined) return BUNDLES[n];
  return n * UNIT_PRICE_EUR;
}

function hasExpressZone(zone) {
  return zone && typeof zone.expressPriceMax === "number";
}

function getDeliveryEurForZone(zone, method) {
  if (!zone) return null;
  const useExpress = method === "express" && hasExpressZone(zone);
  const priceMax = useExpress ? zone.expressPriceMax : zone.priceMax;
  if (zone.currency === "EUR") return priceMax;
  if (zone.currency === "BGN") return priceMax / BGN_TO_EUR;
  return priceMax;
}

function computeExpectedAmountMinor(quantity, shippingZone, shippingMethod, zones) {
  const total = getTotalForQtyOrder(quantity);
  if (total === null) return null;
  if (!shippingZone || !String(shippingZone).trim()) return null;
  const zone = zones.find((z) => z.id === shippingZone);
  if (!zone) return null;
  const delivery = getDeliveryEurForZone(zone, shippingMethod || "standard");
  if (delivery === null) return null;
  const totalEur = Math.round((total + delivery) * 100) / 100;
  return Math.round(totalEur * 100);
}

function revolutCreateOrder(payloadObj, callback) {
  const secret = getRevolutSecretKey();
  const base = (process.env.REVOLUT_API_URL || "").replace(/\/$/, "");
  if (!secret || !base) {
    callback(new Error("REVOLUT_NOT_CONFIGURED"));
    return;
  }
  const body = JSON.stringify(payloadObj);
  const u = new URL(base + "/api/orders");
  const opts = {
    hostname: u.hostname,
    port: u.port || 443,
    path: u.pathname + u.search,
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json",
      "Revolut-Api-Version": REVOLUT_API_VERSION,
      "Content-Length": Buffer.byteLength(body, "utf8"),
    },
  };
  const req = https.request(opts, (r) => {
    let data = "";
    r.on("data", (chunk) => {
      data += chunk;
    });
    r.on("end", () => {
      let json = {};
      try {
        json = JSON.parse(data || "{}");
      } catch (_) {
        json = {};
      }
      callback(null, r.statusCode, json);
    });
  });
  req.on("error", (err) => callback(err));
  req.write(body);
  req.end();
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const FORMSPREE_FORM_ID = process.env.FORMSPREE_FORM_ID || "xjgakygl";
const ALLOWED_ORIGINS = [
  "https://aurahomesystems.eu",
  "https://www.aurahomesystems.eu",
  "http://localhost:8888",
  "http://127.0.0.1:8888",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};

function safeJoin(base, target) {
  const targetPath = path.resolve(base, "." + target);
  if (!targetPath.startsWith(path.resolve(base))) {
    return null;
  }
  return targetPath;
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function setCors(res, req) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function escapeHtmlEmail(s) {
  if (typeof s !== "string") return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function directOrderSummaryListHtmlEmail(data) {
  const q = escapeHtmlEmail(String(data.quantity || "").trim());
  const pm = escapeHtmlEmail(String(data.paymentMethod || "").trim());
  const addr = escapeHtmlEmail(String(data.deliveryAddress || "").trim());
  const phone = escapeHtmlEmail(String(data.phone || "").trim());
  const rev = data.revolutId ? escapeHtmlEmail(String(data.revolutId).trim()) : "";
  return (
    "<ul style=\"margin:12px 0;padding-left:20px;line-height:1.6\">" +
    "<li><strong>Number of sensors:</strong> " + (q || "—") + "</li>" +
    "<li><strong>Payment method:</strong> " + (pm || "—") + "</li>" +
    (rev ? "<li><strong>Revolut:</strong> " + rev + "</li>" : "") +
    "<li><strong>Delivery address:</strong> " + (addr || "—") + "</li>" +
    (phone ? "<li><strong>Phone:</strong> " + phone + "</li>" : "") +
    "</ul>"
  );
}

function buildDirectOrderCustomerEmailHtml(data) {
  const site = "Aura HomeSystems";
  return (
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"></head>" +
    "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
    "<p>Hello,</p>" +
    "<p>Thank you for your order at <strong>" +
    escapeHtmlEmail(site) +
    "</strong>. We received the following details:</p>" +
    directOrderSummaryListHtmlEmail(data) +
    "<p>We will contact you if needed regarding payment and shipping.</p>" +
    "<p>Best regards,<br><strong>" +
    escapeHtmlEmail(site) +
    "</strong></p></body></html>"
  );
}

function sendResendEmail(apiKey, payloadObj, callback) {
  const body = JSON.stringify(payloadObj);
  const opts = {
    hostname: "api.resend.com",
    path: "/emails",
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body, "utf8"),
    },
  };
  const req = https.request(opts, (r) => {
    let d = "";
    r.on("data", (chunk) => {
      d += chunk;
    });
    r.on("end", () => {
      if (callback) callback(null, r.statusCode, d);
    });
  });
  req.on("error", (e) => {
    if (callback) callback(e);
  });
  req.write(body);
  req.end();
}

const nativePushAckState = new Map();
const recentAlarmEvents = [];
const NATIVE_PUSH_EMAIL_FALLBACK_MS = 60 * 1000;
const RECENT_ALARM_EVENTS_TTL_MS = 30 * 60 * 1000;

function rememberNativePushAck(eventTag, stage) {
  const tag = String(eventTag || "").trim();
  const stageStr = String(stage || "").trim();
  if (!tag || !stageStr) return;
  const current = nativePushAckState.get(tag) || { stages: {}, createdAt: Date.now() };
  current.stages[stageStr] = Date.now();
  current.updatedAt = Date.now();
  nativePushAckState.set(tag, current);
}

function hasNativePushShownAck(eventTag) {
  const tag = String(eventTag || "").trim();
  const row = tag ? nativePushAckState.get(tag) : null;
  if (!row || !row.stages) return false;
  return Boolean(row.stages.shown || row.stages.alarm_started || row.stages.dismissed);
}

function cleanupNativePushAckState() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [tag, row] of nativePushAckState.entries()) {
    if (!row || (row.updatedAt || row.createdAt || 0) < cutoff) {
      nativePushAckState.delete(tag);
    }
  }
}

setInterval(cleanupNativePushAckState, 10 * 60 * 1000);

function cleanupRecentAlarmEvents() {
  const cutoff = Date.now() - RECENT_ALARM_EVENTS_TTL_MS;
  while (recentAlarmEvents.length && recentAlarmEvents[0].createdAt < cutoff) {
    recentAlarmEvents.shift();
  }
}

function rememberAlarmEvent(event) {
  if (!event || !event.userKey || !event.eventTag) return;
  cleanupRecentAlarmEvents();
  recentAlarmEvents.push(event);
  if (recentAlarmEvents.length > 500) {
    recentAlarmEvents.splice(0, recentAlarmEvents.length - 500);
  }
}

function getRecentAlarmEvents(userKey, since) {
  cleanupRecentAlarmEvents();
  const sinceNum = Number(since) || 0;
  return recentAlarmEvents
    .filter((event) => event.userKey === userKey && event.createdAt > sinceNum)
    .slice(-20);
}

setInterval(cleanupRecentAlarmEvents, 10 * 60 * 1000);

const PASSWORD_RESET_CONTINUE_URL =
  process.env.PASSWORD_RESET_CONTINUE_URL || "https://aurahomesystems.eu/reset-password.html";

function buildPasswordResetEmail(lang, resetLink) {
  const safeLink = escapeHtmlEmail(resetLink);
  const templates = {
    bg: {
      subject: "Нова парола – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"bg\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Здравейте,</p>" +
        "<p>Поискахте смяна на парола за <strong>Aura HomeSystems</strong>.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Задайте нова парола</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">Ако бутонът не работи, копирайте линка:<br><a href=\"" + safeLink + "\">" + safeLink + "</a></p>" +
        "<p style=\"font-size:0.85rem;color:#777\">Ако не сте поискали това, игнорирайте имейла.</p>" +
        "</body></html>",
    },
    en: {
      subject: "Reset your password – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Hello,</p>" +
        "<p>You requested a password reset for <strong>Aura HomeSystems</strong>.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Set a new password</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">If the button does not work, copy this link:<br><a href=\"" + safeLink + "\">" + safeLink + "</a></p>" +
        "<p style=\"font-size:0.85rem;color:#777\">If you did not request this, you can ignore this email.</p>" +
        "</body></html>",
    },
    de: {
      subject: "Passwort zurücksetzen – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Guten Tag,</p>" +
        "<p>Sie haben ein neues Passwort für <strong>Aura HomeSystems</strong> angefordert.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Neues Passwort festlegen</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">Falls der Button nicht funktioniert, kopieren Sie den Link:<br><a href=\"" + safeLink + "\">" + safeLink + "</a></p>" +
        "<p style=\"font-size:0.85rem;color:#777\">Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.</p>" +
        "</body></html>",
    },
  };
  return templates[lang] || templates.en;
}

function buildWelcomeEmail(lang, resetLink) {
  const safeLink = escapeHtmlEmail(resetLink);
  const templates = {
    bg: {
      subject: "Вашият сензор е готов – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"bg\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Здравейте,</p>" +
        "<p>Настроихте сензор Aura HomeSystems с този имейл. Създадохме акаунт за вас.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Задайте парола и влезте</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">След това отворете <a href=\"https://aurahomesystems.eu/login.html\">aurahomesystems.eu</a> и вижте сензора в таблото.</p>" +
        "<p style=\"font-size:0.85rem;color:#777\">Ако не сте настройвали сензор, игнорирайте имейла.</p>" +
        "</body></html>",
    },
    en: {
      subject: "Your sensor is ready – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Hello,</p>" +
        "<p>Your Aura HomeSystems sensor was set up with this email. We created an account for you.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Set password and sign in</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">Then open <a href=\"https://aurahomesystems.eu/login.html\">aurahomesystems.eu</a> to see your sensor.</p>" +
        "<p style=\"font-size:0.85rem;color:#777\">If you did not set up a sensor, you can ignore this email.</p>" +
        "</body></html>",
    },
    de: {
      subject: "Ihr Sensor ist bereit – Aura HomeSystems",
      html:
        "<!DOCTYPE html><html lang=\"de\"><head><meta charset=\"UTF-8\"></head>" +
        "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
        "<p>Guten Tag,</p>" +
        "<p>Ihr Aura HomeSystems Sensor wurde mit dieser E-Mail eingerichtet. Wir haben ein Konto für Sie erstellt.</p>" +
        "<p><a href=\"" + safeLink + "\" style=\"display:inline-block;padding:12px 20px;background:#22c55e;color:#022c22;text-decoration:none;border-radius:8px;font-weight:600\">Passwort festlegen und anmelden</a></p>" +
        "<p style=\"font-size:0.9rem;color:#555\">Öffnen Sie danach <a href=\"https://aurahomesystems.eu/login.html\">aurahomesystems.eu</a>, um Ihren Sensor zu sehen.</p>" +
        "<p style=\"font-size:0.85rem;color:#777\">Wenn Sie keinen Sensor eingerichtet haben, ignorieren Sie diese E-Mail.</p>" +
        "</body></html>",
    },
  };
  return templates[lang] || templates.en;
}

function normalizeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "-")
    .replace(/@/g, "_at_");
}

function emailCandidatesFromUserKey(userKey) {
  const key = String(userKey || "").trim().toLowerCase();
  const marker = "_at_";
  const at = key.indexOf(marker);
  if (at <= 0) return [];
  const local = key.slice(0, at);
  const domain = key.slice(at + marker.length).replace(/-/g, ".");
  if (!local || !domain || !domain.includes(".")) return [];
  const candidates = [
    local + "@" + domain,
    local.replace(/-/g, ".") + "@" + domain,
  ];
  return [...new Set(candidates)].filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function resolveFirstAuthEmailCandidate(candidates, callback) {
  const list = [...new Set((candidates || []).map((e) => String(e || "").trim().toLowerCase()))]
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  const next = (index) => {
    if (index >= list.length) {
      callback(new Error("Email not found"));
      return;
    }
    firebaseAdmin
      .auth()
      .getUserByEmail(list[index])
      .then((user) => {
        const found = String((user && user.email) || list[index]).trim().toLowerCase();
        callback(null, found);
      })
      .catch(() => next(index + 1));
  };
  next(0);
}

function resolveEmailForUserKey(userKey, fallbackEmail, callback) {
  const emailNorm = String(fallbackEmail || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    callback(null, emailNorm);
    return;
  }
  if (!firebaseDb || !firebaseAdmin) {
    callback(new Error("Firebase not configured"));
    return;
  }
  const directCandidates = emailCandidatesFromUserKey(userKey);
  resolveFirstAuthEmailCandidate(directCandidates, (directErr, directEmail) => {
    if (!directErr && directEmail) {
      callback(null, directEmail);
      return;
    }
  firebaseDb
    .ref("userEmailKeys")
    .orderByValue()
    .equalTo(userKey)
    .limitToFirst(1)
    .once(
      "value",
      (snap) => {
        let uid = "";
        snap.forEach((child) => {
          if (!uid) uid = String(child.key || "").trim();
        });
        if (!uid) {
          callback(new Error("Email not found"));
          return;
        }
        firebaseAdmin
          .auth()
          .getUser(uid)
          .then((user) => {
            const found = String((user && user.email) || "").trim().toLowerCase();
            if (!found || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(found)) {
              callback(new Error("Email not found"));
              return;
            }
            callback(null, found);
          })
          .catch(() => {
            resolveFirstAuthEmailCandidate(emailCandidatesFromUserKey(uid), callback);
          });
      },
      (err) => callback(err || new Error("Email lookup failed"))
    );
  });
}

function buildAlarmFallbackEmail(deviceName, bodyText) {
  const safeDeviceName = escapeHtmlEmail(String(deviceName || "Sensor"));
  const safeBody = escapeHtmlEmail(String(bodyText || "Alarm event detected."));
  return {
    subject: "Alarm alert - " + safeDeviceName,
    html:
      "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"></head>" +
      "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
      "<h2 style=\"margin:0 0 12px;color:#b91c1c\">Aura HomeSystems alarm alert</h2>" +
      "<p><strong>" + safeBody + "</strong></p>" +
      "<p>The Android app did not confirm the phone notification within 60 seconds, so we are sending this backup email alert.</p>" +
      "<p style=\"font-size:0.9rem;color:#555\">Device: " + safeDeviceName + "</p>" +
      "</body></html>",
  };
}

function sendAlarmFallbackEmail(userKey, fallbackEmail, deviceName, bodyText, eventTag) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[alarm-email-fallback] RESEND_API_KEY missing; skipped", userKey, eventTag);
    return;
  }
  resolveEmailForUserKey(userKey, fallbackEmail, (lookupErr, email) => {
    if (lookupErr || !email) {
      console.warn(
        "[alarm-email-fallback] email lookup failed",
        userKey,
        eventTag,
        lookupErr && lookupErr.message ? lookupErr.message : lookupErr || ""
      );
      return;
    }
    const content = buildAlarmFallbackEmail(deviceName, bodyText);
    const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
    sendResendEmail(
      apiKey,
      {
        from: fromAddr,
        to: [email],
        subject: content.subject,
        html: content.html,
      },
      (err, status, respBody) => {
        if (err) {
          console.error("[alarm-email-fallback] send failed:", err.message);
        } else if (status && status >= 400) {
          console.error("[alarm-email-fallback] HTTP:", status, respBody || "");
        } else {
          console.log("[alarm-email-fallback] sent", userKey, email, eventTag);
        }
      }
    );
  });
}

function scheduleAlarmEmailFallback(details) {
  const eventTag = String((details && details.eventTag) || "").trim();
  if (!eventTag) return;
  setTimeout(() => {
    if (hasNativePushShownAck(eventTag)) {
      console.log("[alarm-email-fallback] skipped; Android ACK shown", eventTag);
      return;
    }
    console.warn("[alarm-email-fallback] no Android shown ACK after 60s", eventTag);
    sendAlarmFallbackEmail(
      details.userKey,
      details.email,
      details.deviceName,
      details.bodyText,
      eventTag
    );
  }, NATIVE_PUSH_EMAIL_FALLBACK_MS);
}

function verifyBearerUserKey(req, callback) {
  if (!firebaseAdmin) {
    callback(new Error("NOT_CONFIGURED"));
    return;
  }
  const authHeader = String(req.headers.authorization || "");
  const match = authHeader.match(/^Bearer\s+(\S+)/i);
  if (!match) {
    callback(new Error("UNAUTHORIZED"));
    return;
  }
  firebaseAdmin
    .auth()
    .verifyIdToken(match[1])
    .then((decoded) => {
      const email = decoded && decoded.email;
      if (!email) {
        callback(new Error("UNAUTHORIZED"));
        return;
      }
      callback(null, normalizeEmailKey(email));
    })
    .catch(() => callback(new Error("UNAUTHORIZED")));
}

function createNativePushNonce(userKey, callback) {
  if (!firebaseDb) {
    callback(new Error("NOT_CONFIGURED"));
    return;
  }
  const nonce = crypto.randomBytes(16).toString("hex");
  const expires = Date.now() + 5 * 60 * 1000;
  firebaseDb
    .ref("nativePushReg/" + nonce)
    .set({ userKey, expires })
    .then(() => callback(null, nonce))
    .catch(callback);
}

function registerNativePushToken(nonce, token, callback) {
  if (!firebaseDb) {
    callback(new Error("NOT_CONFIGURED"));
    return;
  }
  const tokenStr = String(token || "").trim();
  const nonceStr = String(nonce || "").trim();
  if (!tokenStr || !nonceStr) {
    callback(new Error("INVALID"));
    return;
  }
  const regRef = firebaseDb.ref("nativePushReg/" + nonceStr);
  regRef.once("value", (snap) => {
    const row = snap.val();
    if (!row || !row.userKey || !row.expires || row.expires < Date.now()) {
      regRef.remove().catch(() => {});
      callback(new Error("EXPIRED"));
      return;
    }
    saveNativeTokenForUser(row.userKey, tokenStr, null, callback);
  }, callback);
}

function sanitizeDeviceId(deviceId) {
  const s = String(deviceId || "").trim();
  if (!/^aura_[a-fA-F0-9]{32}$/.test(s)) return null;
  return s;
}

function saveNativeTokenForUser(userKey, tokenStr, deviceId, callback) {
  if (typeof deviceId === "function") {
    callback = deviceId;
    deviceId = null;
  }
  firebaseDb
    .ref("users/" + userKey + "/pushTokens/native_android")
    .set({
      token: tokenStr,
      platform: "android",
      createdAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
    })
    .then(() => {
      const jobs = [];
      if (deviceId) {
        jobs.push(
          firebaseDb.ref("users/" + userKey + "/settings/nativeDeviceId").set(deviceId)
        );
        jobs.push(
          firebaseDb.ref("nativeDeviceTokens/" + deviceId + "/userKey").set(userKey)
        );
      }
      jobs.push(
        firebaseDb.ref("users/" + userKey + "/pushTokens").once("value").then((tokSnap) => {
          const all = tokSnap.val() || {};
          Object.keys(all).forEach((key) => {
            if (key === "native_android") return;
            const row = all[key];
            if (!row || !row.token) return;
            if (row.platform !== "android" || row.token === tokenStr) {
              firebaseDb
                .ref("users/" + userKey + "/pushTokens/" + key)
                .remove()
                .catch(() => {});
            }
          });
        })
      );
      return Promise.all(jobs);
    })
    .then(() => callback(null, userKey))
    .catch(callback);
}

function refreshNativeTokenBeforeSend(userKey, callback) {
  if (!firebaseDb) {
    callback();
    return;
  }
  const refreshFromLatestDevice = () => {
    firebaseDb
      .ref("nativeDeviceTokens")
      .orderByChild("updatedAt")
      .limitToLast(1)
      .once("value", (latestSnap) => {
        let latestDeviceId = null;
        let latestRow = null;
        latestSnap.forEach((child) => {
          latestDeviceId = sanitizeDeviceId(child.key);
          latestRow = child.val();
        });
        if (!latestDeviceId || !latestRow || !latestRow.token) {
          callback();
          return;
        }
        console.log("[native-push] refreshing token for", userKey, "from latest", latestDeviceId);
        saveNativeTokenForUser(userKey, latestRow.token, latestDeviceId, () => callback());
      }, () => callback());
  };
  firebaseDb.ref("users/" + userKey + "/settings/nativeDeviceId").once("value", (idSnap) => {
    const deviceId = sanitizeDeviceId(idSnap.val());
    if (!deviceId) {
      refreshFromLatestDevice();
      return;
    }
    firebaseDb.ref("nativeDeviceTokens/" + deviceId).once("value", (tokSnap) => {
      const row = tokSnap.val();
      if (!row || !row.token) {
        refreshFromLatestDevice();
        return;
      }
      firebaseDb.ref("users/" + userKey + "/pushTokens/native_android").once("value", (curSnap) => {
        const cur = curSnap.val();
        if (cur && cur.token === row.token) {
          callback();
          return;
        }
        console.log("[native-push] refreshing token for", userKey, "from", deviceId);
        saveNativeTokenForUser(userKey, row.token, deviceId, () => callback());
      }, callback);
    }, callback);
  }, callback);
}

function linkNativeDeviceToUser(userKey, deviceId, callback) {
  if (!firebaseDb) {
    callback(new Error("NOT_CONFIGURED"));
    return;
  }
  const id = sanitizeDeviceId(deviceId);
  if (!id) {
    callback(new Error("INVALID"));
    return;
  }
  firebaseDb.ref("nativeDeviceTokens/" + id).once("value", (snap) => {
    const row = snap.val();
    if (!row || !row.token) {
      callback(new Error("NO_TOKEN"));
      return;
    }
    saveNativeTokenForUser(userKey, row.token, id, callback);
  }, callback);
}

// Best effort: "Your sensor is ready – set a password" email with a reset link for auto-created accounts.
function sendDeviceLinkWelcomeEmail(auth, emailNorm) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[device-link] RESEND_API_KEY missing — welcome email skipped for", emailNorm);
    return;
  }
  auth
    .generatePasswordResetLink(emailNorm, {
      url: PASSWORD_RESET_CONTINUE_URL,
      handleCodeInApp: false,
    })
    .then((link) => {
      const content = buildWelcomeEmail("en", link);
      const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
      sendResendEmail(
        apiKey,
        {
          from: fromAddr,
          to: [emailNorm],
          subject: content.subject,
          html: content.html,
        },
        (err, status, respBody) => {
          if (err) console.error("[device-link] welcome email:", err.message);
          else if (status && status >= 400) {
            console.error("[device-link] welcome email HTTP:", status, respBody || "");
          } else {
            console.log("[device-link] welcome email sent to", emailNorm);
          }
        }
      );
    })
    .catch((e) => {
      console.error("[device-link] reset link failed:", e.message || e);
    });
}

function handleDeviceLinkRequest(body, callback) {
  if (!firebaseAdmin) {
    callback(new Error("DEVICE_LINK_NOT_CONFIGURED"));
    return;
  }
  const emailNorm = String(body.email || "").trim().toLowerCase();
  if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    callback(new Error("INVALID_EMAIL"));
    return;
  }
  const userKey = normalizeEmailKey(emailNorm);
  const auth = firebaseAdmin.auth();
  auth
    .getUserByEmail(emailNorm)
    .then((user) => {
      callback(null, { userKey, uid: user.uid, registered: true });
    })
    .catch((err) => {
      if (err && err.code === "auth/user-not-found") {
        // Сензор с непознат email → създаваме акаунта и пращаме "задай парола".
        // Така редът регистрация/сензор няма значение и никой не остава блокиран.
        auth
          .createUser({ email: emailNorm })
          .then((newUser) => {
            if (firebaseDb) {
              firebaseDb
                .ref("userEmailKeys/" + newUser.uid)
                .set(userKey)
                .catch((e) => console.error("[device-link] userEmailKeys:", e.message || e));
            }
            sendDeviceLinkWelcomeEmail(auth, emailNorm);
            console.log("[device-link] account auto-created for", emailNorm);
            callback(null, { userKey, uid: newUser.uid, registered: true, created: true });
          })
          .catch((createErr) => {
            if (createErr && createErr.code === "auth/invalid-email") {
              // Невалиден по преценка на Firebase → сензорът отваря портала за поправка.
              callback(null, { userKey, registered: false });
              return;
            }
            callback(createErr);
          });
        return;
      }
      callback(err);
    });
}

function handlePasswordResetRequest(email, lang, callback) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!firebaseAdmin || !apiKey) {
    callback(new Error("PASSWORD_RESET_NOT_CONFIGURED"));
    return;
  }
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    callback(new Error("INVALID_EMAIL"));
    return;
  }
  const auth = firebaseAdmin.auth();
  const mailLang = lang === "bg" || lang === "de" ? lang : "en";
  auth
    .getUserByEmail(emailNorm)
    .then(() =>
      auth.generatePasswordResetLink(emailNorm, {
        url: PASSWORD_RESET_CONTINUE_URL,
        handleCodeInApp: false,
      })
    )
    .then((link) => {
      const content = buildPasswordResetEmail(mailLang, link);
      const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
      sendResendEmail(
        apiKey,
        {
          from: fromAddr,
          to: [emailNorm],
          subject: content.subject,
          html: content.html,
        },
        (err, status, body) => {
          if (err) {
            callback(err);
            return;
          }
          if (status && status >= 400) {
            console.error("[Resend] Password reset HTTP:", status, body || "");
            callback(new Error("RESEND_SEND_FAILED"));
            return;
          }
          console.log("[Resend] Password reset email sent to", emailNorm);
          callback(null, true);
        }
      );
    })
    .catch((err) => {
      if (err && err.code === "auth/user-not-found") {
        callback(null, true);
        return;
      }
      callback(err);
    });
}

function maybeSendCustomerOrderConfirmation(parsed) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      "[Resend] Skipping customer email: RESEND_API_KEY is missing. Set it in the environment or in a `.env` file in the project root."
    );
    return;
  }
  if (String(parsed.orderType || "").trim() !== "direct") return;
  const to = String(parsed.email || parsed._replyto || "").trim();
  if (!to) {
    console.warn("[Resend] Skipping customer email: no email in the request.");
    return;
  }
  const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  sendResendEmail(
    key,
    {
      from: fromAddr,
      to: [to],
      subject: "Order confirmation – Aura HomeSystems",
      html: buildDirectOrderCustomerEmailHtml(parsed),
    },
    (err, status, body) => {
      if (err) console.error("Resend customer order email:", err.message);
      else if (status && status >= 400) {
        console.error("Resend customer order email HTTP:", status, body || "");
      } else {
        console.log("[Resend] Order confirmation sent to", to);
      }
    }
  );
}

function forwardToFormspree(body, callback) {
  const payload = JSON.stringify({
    email: body.email || body._replyto,
    _subject: body.subject || body._subject || "Inquiry",
    message: body.message || "",
    phone: body.phone || "",
    sensorsTotal: body.sensorsTotal,
    orderType: body.orderType,
    quantity: body.quantity,
    paymentMethod: body.paymentMethod,
    revolutId: body.revolutId,
    deliveryAddress: body.deliveryAddress
  });
  const opts = {
    hostname: "formspree.io",
    path: "/f/" + FORMSPREE_FORM_ID,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" }
  };
  const req = https.request(opts, (r) => {
    let data = "";
    r.on("data", (chunk) => { data += chunk; });
    r.on("end", () => {
      try {
        const json = JSON.parse(data);
        callback(null, r.statusCode, json);
      } catch (e) {
        callback(null, r.statusCode, { ok: r.statusCode === 200 });
      }
    });
  });
  req.on("error", (err) => callback(err, 500, { error: "Forward failed" }));
  req.write(payload);
  req.end();
}

function parseServiceAccountJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  try {
    return JSON.parse(s);
  } catch (e1) {
    return JSON.parse(s.replace(/\\n/g, "\n"));
  }
}

let firebaseAdmin = null;
let firebaseDb = null;
try {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson && typeof saJson === "string" && saJson.trim()) {
    const serviceAccount = parseServiceAccountJson(saJson);
    if (
      serviceAccount &&
      serviceAccount.private_key &&
      typeof serviceAccount.private_key === "string"
    ) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }
    firebaseAdmin = require("firebase-admin");
    // RTDB access requires databaseURL in firebase-admin initialization.
    // Set it in Render env as FIREBASE_DATABASE_URL.
    const databaseURL =
      process.env.FIREBASE_DATABASE_URL ||
      process.env.FIREBASE_DB_URL ||
      undefined;
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount),
      databaseURL,
    });
    firebaseDb = firebaseAdmin.database();
  } else {
    console.warn("[Aura] FIREBASE_SERVICE_ACCOUNT_JSON not set");
    if (!fs.existsSync(path.join(__dirname, ".env"))) {
      console.warn("[Aura] Local dev: copy .env.example to .env and paste values from Render");
    }
  }
} catch (e) {
  console.warn("[Aura] Firebase Admin not configured:", e.message);
}

function logStartupConfig() {
  const hasResend = !!(
    process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim()
  );
  const hasFirebaseJson = !!(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON).trim()
  );
  console.log(
    "[Aura] password-reset ready:",
    !!(firebaseAdmin && hasResend)
  );
  console.log("[Aura] device-link ready:", !!firebaseAdmin);
  console.log(
    "[Aura] firebase admin:",
    !!firebaseAdmin,
    hasFirebaseJson ? "(JSON present)" : "(JSON missing)"
  );
  console.log(
    "[Aura] resend:",
    hasResend ? "configured" : "missing RESEND_API_KEY"
  );
  console.log("[Aura] diagnostics: GET /api/health");
}

function sendPushToUser(userKey, title, body, callback, forcedEventTag, forcedEventCreatedAt) {
  if (!firebaseDb || !firebaseAdmin) {
    callback(new Error("Firebase not configured"));
    return;
  }
  const pushEventTag =
    String(forcedEventTag || "").trim() ||
    "aura-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const pushEventCreatedAt = Number(forcedEventCreatedAt) || Date.now();
  refreshNativeTokenBeforeSend(userKey, () => {
  firebaseDb.ref("users/" + userKey + "/settings/alertSoundEnabled").once("value", (settingSnap) => {
    const playSound = settingSnap.val() !== false;
    const playFlag = playSound ? "1" : "0";
    firebaseDb.ref("users/" + userKey + "/pushTokens").once("value", (snap) => {
    const val = snap.val();
    if (!val || typeof val !== "object") {
      callback(null, 0, "none");
      return;
    }
    const entries = Object.keys(val)
      .map((key) => ({
        key,
        token: val[key] && val[key].token,
        platform: (val[key] && val[key].platform) || "web",
        createdAt: (val[key] && val[key].createdAt) || 0,
      }))
      .filter((e) => Boolean(e.token));
    const seen = new Set();
    const uniqueEntries = entries.filter((e) => {
      if (seen.has(e.token)) {
        firebaseDb
          .ref("users/" + userKey + "/pushTokens/" + e.key)
          .remove()
          .catch(() => {});
        return false;
      }
      seen.add(e.token);
      return true;
    });
    const tokens = uniqueEntries.map((e) => e.token);
    if (tokens.length > 1) {
      console.log(
        "[FCM]",
        userKey,
        "tokens:",
        tokens.length,
        uniqueEntries.map((e) => e.platform).join(",")
      );
    }
    const sendEntries = uniqueEntries;
    if (sendEntries.length === 0) {
      callback(null, 0, "none");
      return;
    }
    const messaging = firebaseAdmin.messaging();
    let sent = 0;
    const sentVia = [];
    const next = (i) => {
      if (i >= sendEntries.length) {
        callback(null, sent, sentVia.join("+") || "none");
        return;
      }
      const titleStr = String(title || "Aura HomeSystems");
      const bodyStr = String(body || "");
      const entry = sendEntries[i];
      const isNative = entry.key === "native_android" || entry.platform === "android";
      const message = {
        token: entry.token,
        data: {
          title: titleStr,
          body: bodyStr,
          playSound: playFlag,
          eventTag: pushEventTag,
          eventCreatedAt: String(pushEventCreatedAt),
          userKey: String(userKey || ""),
        },
      };
      if (isNative) {
        message.android = {
          priority: "high",
          ttl: 60000,
        };
      } else {
        message.webpush = {
          headers: { Urgency: "high" },
        };
      }
      messaging
        .send(message)
        .then(() => {
          sent++;
          sentVia.push(isNative ? "android" : "web");
          next(i + 1);
        })
        .catch((e) => {
          const code = (e && e.code) || "";
          const msg = String((e && e.message) || "");
          const isDeadToken =
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token" ||
            /unregistered|not.?registered|entity was not found/i.test(msg);
          if (isDeadToken) {
            console.warn("[FCM] removing dead token:", sendEntries[i].key, code || msg);
            firebaseDb
              .ref("users/" + userKey + "/pushTokens/" + sendEntries[i].key)
              .remove()
              .catch(() => {});
            if (isNative) {
              firebaseDb.ref("nativeDeviceTokens").once("value").then((snap) => {
                const all = snap.val() || {};
                Object.keys(all).forEach((deviceId) => {
                  if (all[deviceId] && all[deviceId].token === entry.token) {
                    firebaseDb
                      .ref("nativeDeviceTokens/" + deviceId)
                      .remove()
                      .catch(() => {});
                  }
                });
              }).catch(() => {});
            }
          } else {
            console.warn("[FCM] send failed:", sendEntries[i].key, code || msg || e);
          }
          next(i + 1);
        });
    };
    next(0);
  }, (err) => callback(err));
  }, (err) => callback(err));
  });
}

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];
  const requestUrl = new URL(req.url || "/", "http://localhost");

  if (req.method === "OPTIONS") {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestPath === "/api/alarm-events" && req.method === "GET") {
    setCors(res, req);
    const userKey = String(requestUrl.searchParams.get("userKey") || "").trim();
    const since = Number(requestUrl.searchParams.get("since") || "0") || 0;
    if (!userKey) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Missing userKey" }));
      return;
    }
    const sendEvents = (armed) => {
      const events = armed ? getRecentAlarmEvents(userKey, since) : [];
      console.log(
        "[alarm-events]",
        userKey,
        "armed=" + armed,
        "since=" + since,
        "count=" + events.length
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: true, armed, events }));
    };
    if (!firebaseDb) {
      sendEvents(true);
      return;
    }
    firebaseDb
      .ref("users/" + userKey + "/systemEnabled")
      .once("value")
      .then((snap) => sendEvents(snap.val() === true))
      .catch(() => sendEvents(true));
    return;
  }

  if (requestPath === "/api/native-monitor-user" && req.method === "GET") {
    setCors(res, req);
    const deviceId = sanitizeDeviceId(requestUrl.searchParams.get("deviceId"));
    if (!deviceId) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid deviceId" }));
      return;
    }
    if (!firebaseDb) {
      res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not configured" }));
      return;
    }
    firebaseDb
      .ref("nativeDeviceTokens/" + deviceId + "/userKey")
      .once("value")
      .then((snap) => {
        const directUserKey = String(snap.val() || "").trim();
        if (/^[a-z0-9_-]+_at_[a-z0-9_-]+$/.test(directUserKey)) {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: true, userKey: directUserKey }));
          return;
        }
        return firebaseDb.ref("users").once("value").then((usersSnap) => {
          let found = "";
          usersSnap.forEach((child) => {
            const row = child.val() || {};
            if (!found && row.settings && row.settings.nativeDeviceId === deviceId) {
              found = child.key;
            }
          });
          if (found) {
            firebaseDb.ref("nativeDeviceTokens/" + deviceId + "/userKey").set(found).catch(() => {});
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: true, userKey: found }));
        });
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Lookup failed" }));
      });
    return;
  }

  if (requestPath === "/api/revolut-config" && req.method === "GET") {
    setCors(res, req);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        publicKey: getRevolutPublicKey(),
        mode:
          String(process.env.REVOLUT_CHECKOUT_MODE || "prod").toLowerCase() === "sandbox"
            ? "sandbox"
            : "prod",
      })
    );
    return;
  }

  if (requestPath === "/api/revolut-order" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const currency = String(parsed.currency || "").toUpperCase();
      const amountMinor = parseInt(parsed.amountMinor, 10);
      const quantity = parsed.quantity;
      const shippingZone = parsed.shippingZone ? String(parsed.shippingZone).trim() : "";
      const shippingMethod = parsed.shippingMethod ? String(parsed.shippingMethod).trim() : "standard";
      const description = parsed.description
        ? String(parsed.description).slice(0, 255)
        : "Aura HomeSystems order";

      if (currency !== "EUR" || !Number.isFinite(amountMinor) || amountMinor < 100 || amountMinor > 10000000) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid amount or currency" }));
        return;
      }

      const zones = loadShippingZones();
      const expected = computeExpectedAmountMinor(quantity, shippingZone, shippingMethod, zones);
      if (expected === null || Math.abs(amountMinor - expected) > 1) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Amount does not match order" }));
        return;
      }

      revolutCreateOrder(
        {
          amount: amountMinor,
          currency: "EUR",
          description,
        },
        (err, statusCode, revolutJson) => {
          if (err) {
            if (String(err.message) === "REVOLUT_NOT_CONFIGURED") {
              res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: "Revolut is not configured" }));
              return;
            }
            res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Revolut request failed" }));
            return;
          }
          const publicId = revolutJson && (revolutJson.token || revolutJson.public_id);
          if (!publicId || statusCode < 200 || statusCode >= 300) {
            const msg =
              (revolutJson && (revolutJson.message || revolutJson.error || revolutJson.description)) ||
              "Order creation failed";
            if (statusCode === 401) {
              console.error("[Revolut] Authentication failed – check REVOLUT_API_SECRET_KEY (sandbox sk_... without 'sandbox ' prefix) and REVOLUT_API_URL");
            } else {
              console.error("[Revolut] Create order failed:", statusCode, msg);
            }
            res.writeHead(statusCode >= 400 ? statusCode : 502, {
              "Content-Type": "application/json; charset=utf-8",
            });
            res.end(JSON.stringify({ error: String(msg) }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(
            JSON.stringify({
              revolutPublicOrderId: publicId,
              state: revolutJson.state,
              description: revolutJson.description || description,
            })
          );
        }
      );
    });
    return;
  }

  if (requestPath === "/submitInquiry" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      forwardToFormspree(parsed, (err, statusCode, formspreeRes) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Server error" }));
          return;
        }
        maybeSendCustomerOrderConfirmation(parsed);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true }));
      });
    });
    return;
  }

  if (requestPath === "/api/health" && req.method === "GET") {
    setCors(res, req);
    const hasResend = !!(
      process.env.RESEND_API_KEY && String(process.env.RESEND_API_KEY).trim()
    );
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        ok: true,
        passwordResetReady: !!(firebaseAdmin && hasResend),
        deviceLinkReady: !!firebaseAdmin,
        firebaseAdmin: !!firebaseAdmin,
        resend: hasResend,
        passwordResetRoute: true,
      })
    );
    return;
  }

  if (requestPath === "/api/password-reset" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const email = parsed.email;
      const lang = String(parsed.lang || "en").toLowerCase();
      handlePasswordResetRequest(email, lang, (err) => {
        if (err && err.message === "INVALID_EMAIL") {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid email" }));
          return;
        }
        if (err && err.message === "PASSWORD_RESET_NOT_CONFIGURED") {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Password reset service not configured" }));
          return;
        }
        if (err) {
          console.error("[password-reset]", err.message || err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Send failed" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true }));
      });
    });
    return;
  }

  if (requestPath === "/api/device-link" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      handleDeviceLinkRequest(parsed, (err, result) => {
        if (err && err.message === "INVALID_EMAIL") {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Invalid email" }));
          return;
        }
        if (err && err.message === "DEVICE_LINK_NOT_CONFIGURED") {
          res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Device link service not configured" }));
          return;
        }
        if (err) {
          console.error("[device-link]", err.message || err);
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Device link failed" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      });
    });
    return;
  }

  if (requestPath === "/api/native-push-session" && req.method === "POST") {
    setCors(res, req);
    verifyBearerUserKey(req, (err, userKey) => {
      if (err) {
        const code = err.message === "UNAUTHORIZED" ? 401 : 503;
        res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: err.message || "Unauthorized" }));
        return;
      }
      createNativePushNonce(userKey, (nonceErr, nonce) => {
        if (nonceErr) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Could not create session" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ nonce }));
      });
    });
    return;
  }

  if (requestPath === "/api/native-device-token" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const deviceId = sanitizeDeviceId(parsed.deviceId);
      const token = String(parsed.token || "").trim();
      const linkedUserKey = String(parsed.userKey || "").trim();
      if (!deviceId || !token) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid deviceId or token" }));
        return;
      }
      if (!firebaseDb) {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Not configured" }));
        return;
      }
      firebaseDb
        .ref("nativeDeviceTokens/" + deviceId)
        .update({
          token,
          updatedAt: firebaseAdmin.database.ServerValue.TIMESTAMP,
        })
        .then(() => {
          if (/^[a-z0-9_-]+_at_[a-z0-9_-]+$/.test(linkedUserKey)) {
            saveNativeTokenForUser(linkedUserKey, token, deviceId, () => {});
          }
          console.log("[native-device-token] stored for", deviceId);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(() => {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "Store failed" }));
        });
    });
    return;
  }

  if (requestPath === "/api/link-native-device" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      verifyBearerUserKey(req, (err, userKey) => {
        if (err) {
          const code = err.message === "UNAUTHORIZED" ? 401 : 503;
          res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: err.message || "Unauthorized" }));
          return;
        }
        linkNativeDeviceToUser(userKey, parsed.deviceId, (linkErr, linkedKey) => {
          if (linkErr) {
            const code =
              linkErr.message === "NO_TOKEN" || linkErr.message === "INVALID" ? 404 : 500;
            res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: linkErr.message || "Link failed" }));
            return;
          }
          console.log("[native-push] linked device for", linkedKey);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ success: true }));
        });
      });
    });
    return;
  }

  if (requestPath === "/api/register-native-push" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      registerNativePushToken(parsed.nonce, parsed.token, (regErr, userKey) => {
        if (regErr) {
          const code =
            regErr.message === "EXPIRED" || regErr.message === "INVALID" ? 400 : 500;
          res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: regErr.message || "Register failed" }));
          return;
        }
        console.log("[native-push] registered for", userKey);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true }));
      });
    });
    return;
  }

  if (requestPath === "/api/native-push-ack" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const deviceId = sanitizeDeviceId(parsed.deviceId) || String(parsed.deviceId || "").slice(0, 80);
      const stage = String(parsed.stage || "unknown").slice(0, 80);
      const eventTag = String(parsed.eventTag || "").slice(0, 120);
      const userKey = String(parsed.userKey || "").slice(0, 120);
      const channelId = String(parsed.channelId || "").slice(0, 120);
      rememberNativePushAck(eventTag, stage);
      console.log(
        "[native-push-ack]",
        stage,
        userKey || "no-user",
        deviceId || "no-device",
        eventTag || "no-event",
        channelId || "no-channel"
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  if (requestPath === "/api/sensor-event" && req.method === "POST") {
    setCors(res, req);
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const userKey =
        parsed.userKey ||
        parsed.uid ||
        parsed.userId ||
        (parsed.email ? normalizeEmailKey(parsed.email) : "");
      const deviceId = parsed.deviceId || parsed.sensorId;
      const state = parsed.state;
      const deviceName = parsed.deviceName || deviceId || "Sensor";
      if (!userKey) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Missing userKey" }));
        return;
      }
      const isOpen = state === "open" || state === true;
      const title = "Aura HomeSystems";
      const bodyText = isOpen
        ? deviceName + " was opened."
        : deviceName + " was closed.";
      const eventTag = "aura-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      const eventCreatedAt = Date.now();
      if (!firebaseDb || !firebaseAdmin) {
        res.writeHead(503, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Firebase not configured" }));
        return;
      }
      const safeDeviceId = String(deviceId || deviceName || "sensor").replace(/[.$#[\]/]/g, "_");
      const devicePath = "users/" + userKey + "/devices/" + safeDeviceId;
      const historyRef = firebaseDb.ref("users/" + userKey + "/history").push();
      const timestamp = firebaseAdmin.database.ServerValue.TIMESTAMP;
      const deviceUpdate = {
        status: !isOpen,
        deviceName,
        lastSeen: timestamp,
      };
      if (typeof parsed.battery === "number") deviceUpdate.battery = parsed.battery;
      if (parsed.powerSource) deviceUpdate.powerSource = String(parsed.powerSource);

      Promise.all([
        firebaseDb.ref(devicePath).update(deviceUpdate),
        historyRef.set({
          deviceId: safeDeviceId,
          deviceName,
          status: isOpen ? "open" : "closed",
          timestamp,
        }),
        firebaseDb.ref("users/" + userKey + "/systemEnabled").once("value"),
      ])
        .then((results) => {
          const systemEnabled = results[2].val() === true;
          if (!systemEnabled) {
            console.log("[sensor-event]", userKey, "sent:", 0, "via", "off");
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: true, sent: 0, via: "off" }));
            return;
          }
          rememberAlarmEvent({
            userKey,
            eventTag,
            createdAt: eventCreatedAt,
            title,
            body: bodyText,
            deviceName,
            state: isOpen ? "open" : "closed",
          });
          sendPushToUser(userKey, title, bodyText, (err, sent, via) => {
            if (err) {
              res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ error: err.message }));
              return;
            }
            if (String(via || "").split("+").includes("android")) {
              scheduleAlarmEmailFallback({
                userKey,
                email: parsed.email,
                deviceName,
                bodyText,
                eventTag,
              });
            }
            console.log("[sensor-event]", userKey, "sent:", sent, "via", via || "none");
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: true, sent, via, eventTag, eventCreatedAt }));
          }, eventTag, eventCreatedAt);
        })
        .catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: err.message || "Sensor event failed" }));
        });
    });
    return;
  }

  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = safeJoin(ROOT, normalizedPath);

  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      sendFile(res, filePath);
      return;
    }

    // Same as Netlify "Pretty URLs": /login -> login.html, /register -> register.html
    if (path.extname(normalizedPath) === "") {
      const htmlCandidate = safeJoin(ROOT, normalizedPath + ".html");
      if (htmlCandidate) {
        fs.stat(htmlCandidate, (htmlErr, htmlStats) => {
          if (!htmlErr && htmlStats.isFile()) {
            sendFile(res, htmlCandidate);
            return;
          }
          sendIndexFallback();
        });
        return;
      }
    }

    sendIndexFallback();

    function sendIndexFallback() {
    const fallbackPath = path.join(ROOT, "index.html");
    fs.stat(fallbackPath, (fallbackErr, fallbackStats) => {
      if (!fallbackErr && fallbackStats.isFile()) {
        sendFile(res, fallbackPath);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logStartupConfig();
});
