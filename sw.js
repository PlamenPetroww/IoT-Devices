/**
 * Минимален service worker за PWA Builder / Google Play TWA.
 * Без външни importScripts – иначе pwabuilder.com „виси“ при анализ.
 * Push: firebase-messaging-sw.js (регистрира се от dashboard при „Включи известия“).
 */
const CACHE_VERSION = "aura-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
