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
  // Support both notification and data payloads.
  const title =
    (payload.notification && payload.notification.title) ||
    (payload.data && payload.data.title) ||
    "Aura HomeSystems";
  const body =
    (payload.notification && payload.notification.body) ||
    (payload.data && payload.data.body) ||
    "";
  const options = { body, icon: "/favicon.png" };
  return self.registration.showNotification(title, options);
});
