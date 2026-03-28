const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

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

function loadShippingZones() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, "shipping.json"), "utf8");
    const j = JSON.parse(raw);
    return Array.isArray(j.zones) ? j.zones : [];
  } catch (e) {
    return [];
  }
}

const UNIT_PRICE_EUR = 69;
const BUNDLES = { 1: 69, 3: 189, 5: 299 };
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
  const secret = process.env.REVOLUT_API_SECRET_KEY;
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
    "<li><strong>Брой сензори:</strong> " + (q || "—") + "</li>" +
    "<li><strong>Начин на плащане:</strong> " + (pm || "—") + "</li>" +
    (rev ? "<li><strong>Revolut:</strong> " + rev + "</li>" : "") +
    "<li><strong>Адрес за доставка:</strong> " + (addr || "—") + "</li>" +
    (phone ? "<li><strong>Телефон:</strong> " + phone + "</li>" : "") +
    "</ul>"
  );
}

function buildDirectOrderCustomerEmailHtml(data) {
  const site = "Aura HomeSystems";
  return (
    "<!DOCTYPE html><html lang=\"bg\"><head><meta charset=\"UTF-8\"></head>" +
    "<body style=\"font-family:system-ui,sans-serif;line-height:1.55;color:#1a1a1a;max-width:560px\">" +
    "<p>Здравейте,</p>" +
    "<p>Благодарим за вашата поръчка в <strong>" +
    escapeHtmlEmail(site) +
    "</strong>. Получихме следните данни:</p>" +
    directOrderSummaryListHtmlEmail(data) +
    "<p>Ще се свържем с вас при необходимост относно плащане и изпращане.</p>" +
    "<p>Поздрави,<br><strong>" +
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

function maybeSendCustomerOrderConfirmation(parsed) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      "[Resend] Пропускаме имейл до клиента: няма RESEND_API_KEY. Задайте го в средата или във файл `.env` в корена на проекта."
    );
    return;
  }
  if (String(parsed.orderType || "").trim() !== "direct") return;
  const to = String(parsed.email || parsed._replyto || "").trim();
  if (!to) {
    console.warn("[Resend] Пропускаме имейл до клиента: липсва email в заявката.");
    return;
  }
  const fromAddr = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
  sendResendEmail(
    key,
    {
      from: fromAddr,
      to: [to],
      subject: "Потвърждение на поръчка – Aura HomeSystems",
      html: buildDirectOrderCustomerEmailHtml(parsed),
    },
    (err, status, body) => {
      if (err) console.error("Resend customer order email:", err.message);
      else if (status && status >= 400) {
        console.error("Resend customer order email HTTP:", status, body || "");
      } else {
        console.log("[Resend] Изпратено потвърждение на поръчка до", to);
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

let firebaseAdmin = null;
let firebaseDb = null;
try {
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (saJson && typeof saJson === "string") {
    const serviceAccount = JSON.parse(saJson);
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
  }
} catch (e) {
  console.warn("Firebase Admin not configured (FIREBASE_SERVICE_ACCOUNT_JSON):", e.message);
}

function sendPushToUser(uid, title, body, callback) {
  if (!firebaseDb || !firebaseAdmin) {
    callback(new Error("Firebase not configured"));
    return;
  }
  firebaseDb.ref("users/" + uid + "/pushTokens").once("value", (snap) => {
    const val = snap.val();
    if (!val || typeof val !== "object") {
      callback(null, 0);
      return;
    }
    const tokens = Object.values(val).map((v) => v && v.token).filter(Boolean);
    if (tokens.length === 0) {
      callback(null, 0);
      return;
    }
    const messaging = firebaseAdmin.messaging();
    let sent = 0;
    const next = (i) => {
      if (i >= tokens.length) {
        callback(null, sent);
        return;
      }
      messaging.send({
        token: tokens[i],
        // Send as data message so the service worker can reliably show
        // the notification via onBackgroundMessage.
        data: {
          title: String(title || "Aura HomeSystems"),
          body: String(body || "")
        }
      }).then(() => { sent++; next(i + 1); }).catch(() => { next(i + 1); });
    };
    next(0);
  }, (err) => callback(err));
}

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    setCors(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestPath === "/api/revolut-config" && req.method === "GET") {
    setCors(res, req);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        publicKey: process.env.REVOLUT_API_PUBLIC_KEY || "",
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
      const uid = parsed.uid || parsed.userId;
      const deviceId = parsed.deviceId || parsed.sensorId;
      const state = parsed.state;
      const deviceName = parsed.deviceName || deviceId || "Сензор";
      if (!uid) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Missing uid" }));
        return;
      }
      const isOpen = state === "open" || state === true;
      const title = "Aura HomeSystems";
      const bodyText = isOpen
        ? deviceName + " е отворен(а)."
        : deviceName + " е затворен(а).";
      sendPushToUser(uid, title, bodyText, (err, sent) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true, sent }));
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
});
