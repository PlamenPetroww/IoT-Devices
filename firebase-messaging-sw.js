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

function pushStatusIcon(title, body) {
  var text = ((title || "") + "\n" + (body || "")).toLowerCase();
  if (text.indexOf("was closed") !== -1 || text.indexOf("wurde geschlossen") !== -1) {
    return "/icons/push-closed.png";
  }
  if (text.indexOf("was opened") !== -1 || text.indexOf("wurde geöffnet") !== -1) {
    return "/icons/push-open.png";
  }
  return "/favicon.png";
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

firebase.messaging().onBackgroundMessage((payload) => {
  const data = (payload && payload.data) || {};
  // Alarms are handled by the Android app (native FCM). Web must never duplicate them.
  if (data.skipWeb === "1" || (data.eventTag && String(data.eventTag).indexOf("cf-") === 0)) {
    return null;
  }
  const playSound = data.playSound !== "0";
  const title = data.title || "Aura HomeSystems";
  const body = data.body || "";
  const options = {
    body,
    icon: pushStatusIcon(title, body),
    tag: data.eventTag || "aura-" + Date.now(),
    renotify: true,
    silent: !playSound,
    vibrate: playSound ? [180, 90, 180] : [],
  };

  // App отворен на екрана → foreground handler показва; иначе 2 еднакви известия.
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].visibilityState === "visible") return null;
      }
      return self.registration.showNotification(title, options);
    })
    .catch(function (e) {
      console.error("[firebase-messaging-sw] showNotification failed:", e);
      return null;
    });
});
