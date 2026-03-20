/**
 * Service worker за Firebase Cloud Messaging (push известия).
 * Замени firebaseConfig по-долу със същите стойности като в firebase-config.js
 * (от Firebase Console → Project settings → Your apps).
 */
importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js"
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

firebase.messaging().onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw] onBackgroundMessage payload:", payload);
  // Support both notification and data payloads.
  const title =
    (payload.notification && payload.notification.title) ||
    (payload.data && payload.data.title) ||
    "Aura HomeSystems";
  const body =
    (payload.notification && payload.notification.body) ||
    (payload.data && payload.data.body) ||
    "";
  const options = { body, icon: "/favicon.png", tag: "aura-push" };
  try {
    return self.registration.showNotification(title, options);
  } catch (e) {
    console.error("[firebase-messaging-sw] showNotification failed:", e);
    return null;
  }
});

// Fallback: handle raw 'push' event in case Firebase background handler
// doesn't get triggered by the DevTools "Push test message".
self.addEventListener("push", (event) => {
  try {
    const raw = event.data ? event.data.text() : "";
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (parseErr) {
      payload = { raw };
    }

    const data = payload && payload.data ? payload.data : payload || {};
    const title = data.title || (payload.notification && payload.notification.title) || "Aura HomeSystems";
    const body = data.body || (payload.notification && payload.notification.body) || "";

    console.log("[firebase-messaging-sw] raw push fallback payload:", payload);

    const options = { body, icon: "/favicon.png", tag: "aura-push" };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    console.error("[firebase-messaging-sw] push fallback failed:", e);
  }
});
