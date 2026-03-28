/**
 * Backend за запитвания и поръчки. На production – Render → Formspree (+ Resend за имейл до клиента).
 * На localhost сървъра (node server.js) автоматично се ползва http://localhost:3000 за тест.
 */
(function () {
  var h = typeof location !== "undefined" ? location.hostname : "";
  var isLocal = h === "localhost" || h === "127.0.0.1";
  window.INQUIRY_FUNCTIONS_BASE_URL = isLocal
    ? "http://localhost:3000"
    : "https://cleverhaus.onrender.com";
})();
