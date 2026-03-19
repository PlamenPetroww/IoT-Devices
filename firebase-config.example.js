/**
 * Пример за Firebase конфигурация.
 * Копирай този файл като firebase-config.js и попълни стойностите от Firebase Console:
 * https://console.firebase.google.com/ → твой проект → Project settings → Your apps
 *
 * За push известия: Project settings → Cloud Messaging → Web Push certificates → Generate key pair.
 * Сложи ключа тук (и същите apiKey/projectId/messagingSenderId/appId в firebase-messaging-sw.js):
 */
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "1:YOUR_SENDER_ID:web:YOUR_APP_ID"
};

// За push известия в dashboard (от Cloud Messaging → Web Push certificates):
// window.FIREBASE_VAPID_KEY = "Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

// Инициализация (се използва от login, register, dashboard)
if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
}
