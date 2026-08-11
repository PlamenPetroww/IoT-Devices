/**
 * Capacitor iOS bridge for Firebase Cloud Messaging.
 * The Firebase Messaging plugin returns an FCM token (not a raw APNs token),
 * so the existing Firebase Admin backend can deliver to iPhone.
 */
(function (global) {
  "use strict";

  var listenerBound = false;

  function isIosApp() {
    try {
      return (
        global.Capacitor &&
        typeof global.Capacitor.isNativePlatform === "function" &&
        global.Capacitor.isNativePlatform() &&
        global.Capacitor.getPlatform() === "ios"
      );
    } catch (_) {
      return false;
    }
  }

  function plugin() {
    return (
      isIosApp() &&
      global.Capacitor.Plugins &&
      global.Capacitor.Plugins.FirebaseMessaging
    );
  }

  function tokenKey(token) {
    var hash = 2166136261;
    for (var i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return "native_ios_" + (hash >>> 0).toString(36);
  }

  async function saveToken(userPath, db, token) {
    if (!userPath || !db || !token) return false;
    var key = tokenKey(token);
    var ref = db.ref(userPath + "/pushTokens");
    var snap = await ref.once("value");
    var all = snap.val() || {};
    var previousKey = "";
    try {
      previousKey = global.localStorage.getItem("auraIosPushKey") || "";
    } catch (_) {}
    if (
      previousKey &&
      previousKey !== key &&
      all[previousKey] &&
      all[previousKey].platform === "ios"
    ) {
      await ref.child(previousKey).remove();
    }

    await ref.child(key).set({
      token: token,
      platform: "ios",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    try {
      global.localStorage.setItem("auraIosPushKey", key);
    } catch (_) {}
    return true;
  }

  function bindListeners(messaging, userPath, db) {
    if (listenerBound || !messaging || !messaging.addListener) return;
    listenerBound = true;

    messaging.addListener("tokenReceived", function (event) {
      if (event && event.token) {
        saveToken(userPath, db, event.token).catch(function (err) {
          console.warn("[ios-push] token refresh save failed", err);
        });
      }
    });

    function acknowledge(notification) {
      var data = notification && notification.data;
      if (data && data.eventTag) {
        db.ref(userPath + "/alarmDeliveries/" + data.eventTag).update({
          state: "ack_shown",
          ackShownAt: firebase.database.ServerValue.TIMESTAMP,
        }).catch(function () {});
      }
    }

    messaging.addListener("notificationReceived", function (notification) {
      acknowledge(notification);
    });

    messaging.addListener("notificationActionPerformed", function (event) {
      acknowledge(event && event.notification);
    });
  }

  async function register(userPath, db, requestPermission) {
    var messaging = plugin();
    if (!messaging) return false;

    var permission = await messaging.checkPermissions();
    if (
      requestPermission !== false &&
      permission &&
      permission.receive === "prompt"
    ) {
      permission = await messaging.requestPermissions();
    }
    if (!permission || permission.receive !== "granted") return false;

    bindListeners(messaging, userPath, db);
    var result = await messaging.getToken();
    if (!result || !result.token) return false;
    return saveToken(userPath, db, result.token);
  }

  global.AuraIosPush = {
    isIosApp: isIosApp,
    register: register,
  };
})(window);
