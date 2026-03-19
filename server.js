const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const FORMSPREE_FORM_ID = process.env.FORMSPREE_FORM_ID || "xjgakygl";
const ALLOWED_ORIGINS = [
  "https://aurahomesystems.eu",
  "https://www.aurahomesystems.eu",
  "http://localhost:8888",
  "http://127.0.0.1:8888"
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

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];

  if (req.method === "OPTIONS") {
    setCors(res, req);
    res.writeHead(204);
    res.end();
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
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ success: true }));
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

    const fallbackPath = path.join(ROOT, "index.html");
    fs.stat(fallbackPath, (fallbackErr, fallbackStats) => {
      if (!fallbackErr && fallbackStats.isFile()) {
        sendFile(res, fallbackPath);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
