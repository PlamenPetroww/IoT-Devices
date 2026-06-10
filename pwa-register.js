/** Регистрира service worker за PWA / Google Play TWA (същият файл като за push). */
(function () {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("/sw.js").catch(function () {});
    });
})();
