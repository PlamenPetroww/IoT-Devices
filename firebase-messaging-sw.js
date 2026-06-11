/**
 * Firebase Cloud Messaging – push известия (отделен от /sw.js заради PWA Builder).
 */
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"
);

const firebaseConfig = {
  apiKey: "AIzaSyAa6_Cq7X-aCUB5SmTz_jb6R345JtVaHl8",
  authDomain: "cleverhaus-petrov.firebaseapp.com",
  projectId: "cleverhaus-petrov",
  storageBucket: "cleverhaus-petrov.firebasestorage.app",
  messagingSenderId: "435229084392",
  appId: "1:435229084392:web:72c40188f847cc721a175d"
};

firebase.initializeApp(firebaseConfig);

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

firebase.messaging().onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  const playSound = data.playSound !== "0";
  const title =
    (payload.notification && payload.notification.title) ||
    data.title ||
    "Aura HomeSystems";
  const body =
    (payload.notification && payload.notification.body) ||
    data.body ||
    "";
  const options = {
    body,
    icon: "/favicon.png",
    // Tag на събитие (от сървъра): отделно известие за всяко събитие, без тиха замяна.
    tag: data.eventTag || "aura-" + Date.now(),
    renotify: true,
    silent: !playSound,
    vibrate: playSound ? [180, 90, 180] : [],
  };
  try {
    return self.registration.showNotification(title, options);
  } catch (e) {
    console.error("[firebase-messaging-sw] showNotification failed:", e);
    return null;
  }
});
