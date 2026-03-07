/**
 * Firebase конфигурация за уеб приложението.
 * Същият Realtime Database като Arduino (cleverhaus-petrov).
 */
const firebaseConfig = {
    apiKey: "AIzaSyAa6_Cq7X-aCUB5SmTz_jb6R345JtVaHl8",
    authDomain: "cleverhaus-petrov.firebaseapp.com",
    databaseURL: "https://cleverhaus-petrov-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "cleverhaus-petrov",
    storageBucket: "cleverhaus-petrov.firebasestorage.app",
    messagingSenderId: "435229084392",
    appId: "1:435229084392:web:72c40188f847cc721a175d"
};

// Инициализация (се използва от login, register, dashboard)
if (typeof firebase !== "undefined") {
    firebase.initializeApp(firebaseConfig);
}
