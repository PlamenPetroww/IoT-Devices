/**
 * Push (FCM): overlay при login (Да/Не); при „Навън“ – същият blur фон.
 */
(function (global) {
  "use strict";

  var state = {
    status: "unknown",
    message: "",
    userPath: null,
    db: null,
    onStateChange: null,
    pendingAway: false,
    foregroundBound: false,
    overlayMode: null,
    visibilityBound: false,
    pushKind: "none",
  };

  var els = {};

  function notify() {
    if (typeof state.onStateChange === "function") state.onStateChange(state);
    updateUi();
  }

  function isSupported() {
    return "Notification" in global && typeof firebase !== "undefined" && !!firebase.messaging;
  }

  function getVapidKey() {
    return (
      global.FIREBASE_VAPID_KEY ||
      (typeof firebaseConfig !== "undefined" && firebaseConfig.vapidKey) ||
      ""
    );
  }

  function isActive() {
    return state.status === "active";
  }

  function onboardingDismissed() {
    try {
      return sessionStorage.getItem("auraPushOnboardingDismissed") === "1";
    } catch (_) {
      return false;
    }
  }

  function setOnboardingDismissed() {
    try {
      sessionStorage.setItem("auraPushOnboardingDismissed", "1");
    } catch (_) {}
  }

  function markRegistered() {
    try {
      localStorage.setItem("auraPushRegistered", "1");
    } catch (_) {}
  }

  function clearRegisteredLocally() {
    try {
      localStorage.removeItem("auraPushRegistered");
    } catch (_) {}
  }

  function wasRegisteredLocally() {
    try {
      return localStorage.getItem("auraPushRegistered") === "1";
    } catch (_) {
      return false;
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    } catch (err) {
      console.warn("[push] SW registration failed:", err && err.message ? err.message : err);
      return null;
    }
  }

  function shouldPlayAlertSound(payload) {
    var d = payload && payload.data;
    if (d && d.playSound === "0") return false;
    return true;
  }

  function playAlertSound() {
    try {
      var AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(function () {
        try {
          osc.stop();
          ctx.close();
        } catch (_) {}
      }, 220);
    } catch (_) {}
  }

  function bindForegroundHandler(messaging) {
    if (!messaging || !messaging.onMessage || state.foregroundBound) return;
    state.foregroundBound = true;
    messaging.onMessage(function (payload) {
      try {
        var title =
          (payload && payload.data && payload.data.title) || "Aura HomeSystems";
        var body = (payload && payload.data && payload.data.body) || "";
        var playSound = shouldPlayAlertSound(payload);
        if ("Notification" in global && Notification.permission === "granted") {
          var tag =
            (payload && payload.data && payload.data.eventTag) ||
            "aura-" + Date.now();
          new Notification(title, {
            body: body,
            icon: "/favicon.png",
            tag: tag,
            silent: !playSound,
          });
        }
        if (playSound) playAlertSound();
      } catch (err) {
        console.warn("[push] Foreground notification failed:", err);
      }
    });
  }

  function getApiBase() {
    if (global.INQUIRY_FUNCTIONS_BASE_URL) return global.INQUIRY_FUNCTIONS_BASE_URL;
    var h = global.location && global.location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3000";
    return "https://cleverhaus.onrender.com";
  }

  function isAuraAndroidTwa() {
    var ua = global.navigator && global.navigator.userAgent ? global.navigator.userAgent : "";
    if (!/Android/i.test(ua)) return false;
    var host = global.location && global.location.hostname;
    if (host !== "aurahomesystems.eu" && host !== "www.aurahomesystems.eu") return false;
    try {
      if (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (_) {}
    try {
      if (global.matchMedia && global.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (_) {}
    try {
      var ref = global.document.referrer || "";
      if (ref.indexOf("android-app://") === 0) return true;
    } catch (_) {}
    // Play Store TWA on our domain (not mobile Firefox).
    return !/Firefox/i.test(ua);
  }

  function setPushHint(text) {
    if (state.overlayMode === "away") {
      setAwayHint(text);
      return;
    }
    if (!els.dialogHint) return;
    if (text) {
      els.dialogHint.textContent = text;
      els.dialogHint.hidden = false;
    } else {
      els.dialogHint.hidden = true;
      els.dialogHint.textContent = "";
    }
  }

  function areAndroidNotificationsEnabled() {
    if (!isAuraAndroidTwa()) return true;
    try {
      return localStorage.getItem("auraNotifyOk") === "1";
    } catch (_) {
      return true;
    }
  }

  function openAndroidNotificationSettings() {
    try {
      global.location.href =
        "intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;" +
        "S.android.provider.extra.APP_PACKAGE,com.aurahomesystems.app;end";
      return true;
    } catch (_) {
      return false;
    }
  }

  function captureDeviceId() {
    try {
      var params = new URLSearchParams(global.location.search || "");
      var did = params.get("aura_did");
      if (did) {
        localStorage.setItem("auraDeviceId", did);
      }
    } catch (_) {}
  }

  async function saveNativeAndroidToken(token) {
    if (!state.db || !state.userPath || !token) return false;
    var ref = state.db.ref(state.userPath + "/pushTokens");
    await ref.child("native_android").set({
      token: token,
      platform: "android",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    var snap = await ref.once("value");
    var all = snap.val() || {};
    Object.keys(all).forEach(function (k) {
      if (k === "native_android") return;
      var row = all[k];
      if (!row || !row.token) return;
      if (row.platform !== "android" || row.token === token) {
        ref.child(k).remove().catch(function () {});
      }
    });
    return true;
  }

  async function linkNativeDeviceViaRtdb(deviceId) {
    if (!state.db || !deviceId) return false;
    var userKey = (state.userPath || "").replace(/^users\//, "");
    if (!userKey) return false;
    var snap = await state.db.ref("nativeDeviceTokens/" + deviceId).once("value");
    var row = snap.val();
    if (!row || !row.token) return false;
    await state.db.ref("nativeDeviceTokens/" + deviceId + "/userKey").set(userKey);
    await state.db.ref(state.userPath + "/settings/nativeDeviceId").set(deviceId);
    return saveNativeAndroidToken(row.token);
  }

  async function linkNativeDevice() {
    if (!isAuraAndroidTwa()) return false;
    captureDeviceId();
    var deviceId = null;
    try {
      deviceId = localStorage.getItem("auraDeviceId");
    } catch (_) {}
    if (!deviceId || typeof firebase === "undefined" || !firebase.auth) return false;
    var user = firebase.auth().currentUser;
    if (!user) return false;

    try {
      var idToken = await user.getIdToken();
      var resp = await fetch(getApiBase() + "/api/link-native-device", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + idToken,
        },
        body: JSON.stringify({ deviceId: deviceId }),
      });
      var contentType = resp.headers.get("content-type") || "";
      if (resp.ok && contentType.indexOf("application/json") !== -1) {
        return true;
      }
    } catch (err) {
      console.warn("[push] link-native-device fetch failed:", err);
    }

    try {
      return await linkNativeDeviceViaRtdb(deviceId);
    } catch (rtdbErr) {
      console.warn("[push] link via RTDB failed:", rtdbErr);
      return false;
    }
  }

  async function removeWebPushTokensOnTwa() {
    if (!isAuraAndroidTwa() || !state.db || !state.userPath) return;
    var snap = await state.db.ref(state.userPath + "/pushTokens").once("value");
    var val = snap.val() || {};
    Object.keys(val).forEach(function (k) {
      if (k === "native_android") return;
      var row = val[k];
      if (row && row.token && row.platform !== "android") {
        state.db.ref(state.userPath + "/pushTokens/" + k).remove().catch(function () {});
      }
    });
  }

  async function ensureNativePushLinked() {
    if (!isAuraAndroidTwa()) return false;
    if (await hasServerPushToken()) return true;
    captureDeviceId();
    var deviceId = null;
    try {
      deviceId = localStorage.getItem("auraDeviceId");
    } catch (_) {}
    if (!deviceId) {
      state.message =
        (global.authT && global.authT("push.reopenApp")) ||
        "Close the app completely and open it again.";
      setPushHint(state.message);
      if (els.chip) els.chip.textContent = state.message;
      notify();
      return false;
    }
    var linkingText =
      (global.authT && global.authT("push.linking")) || "Linking phone alerts…";
    setPushHint(linkingText);
    if (els.chip) {
      els.chip.textContent = linkingText;
    }
    var deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      var linked = await linkNativeDevice();
      await syncPushStatusFromServer();
      if (state.pushKind === "native") {
        setPushHint("");
        notify();
        return true;
      }
      if (linked) {
        await sleep(400);
        continue;
      }
      if (els.chip) els.chip.textContent = linkingText;
      await sleep(2000);
    }
    state.message =
      (global.authT && global.authT("push.linkWait")) ||
      "Wait 5 sec., reopen the app, then tap the yellow text again.";
    setPushHint(state.message);
    notify();
    return false;
  }

  function openNativeBridgeIntent(intentUrl) {
    try {
      global.location.href = intentUrl;
      return true;
    } catch (_) {}
    try {
      var link = global.document.createElement("a");
      link.href = intentUrl;
      link.style.display = "none";
      global.document.body.appendChild(link);
      link.click();
      global.document.body.removeChild(link);
      return true;
    } catch (_) {
      return false;
    }
  }

  function notifyNativeUserKey(userKey) {
    if (!userKey) return false;
    var intentUrl =
      "intent://native-push?userKey=" +
      encodeURIComponent(userKey) +
      "#Intent;scheme=aurahomesystems;package=com.aurahomesystems.app;end";
    try {
      var iframe = global.document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = intentUrl;
      global.document.body.appendChild(iframe);
      setTimeout(function () {
        try {
          iframe.remove();
        } catch (_) {}
      }, 1500);
      return true;
    } catch (_) {
      return openNativeBridgeIntent(intentUrl);
    }
  }

  function syncNativeUserKeyToApp(userKey) {
    if (!isAuraAndroidTwa() || !userKey) return false;
    var shouldNotifyNative = true;
    try {
      var lastKey = sessionStorage.getItem("auraNativeUserKey");
      shouldNotifyNative = lastKey !== userKey;
      sessionStorage.setItem("auraNativeUserKey", userKey);
    } catch (_) {}
    if (shouldNotifyNative) {
      notifyNativeUserKey(userKey);
    }
    linkNativeDevice().catch(function () {});
    return true;
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function getPushTokenKind() {
    if (!state.db || !state.userPath) return "none";
    var snap = await state.db.ref(state.userPath + "/pushTokens").once("value");
    var val = snap.val();
    if (!val || typeof val !== "object") return "none";
    if (val.native_android && val.native_android.token) return "native";
    var hasWeb = Object.keys(val).some(function (k) {
      return val[k] && val[k].token;
    });
    return hasWeb ? "web" : "none";
  }

  async function hasServerPushToken() {
    var kind = await getPushTokenKind();
    if (isAuraAndroidTwa()) return kind === "native";
    return kind !== "none";
  }

  async function syncPushStatusFromServer() {
    state.pushKind = await getPushTokenKind();
    var hasToken = await hasServerPushToken();
    if (state.pushKind === "native") {
      markRegistered();
      state.status = "active";
    } else if (hasToken) {
      markRegistered();
      state.status = "active";
    } else {
      clearRegisteredLocally();
      if (state.status === "active") {
        state.status = "pending";
      }
    }
    notify();
    return hasToken;
  }

  async function waitForServerPushToken(maxMs) {
    var deadline = Date.now() + (maxMs || 5000);
    while (Date.now() < deadline) {
      if (await hasServerPushToken()) return true;
      await sleep(400);
    }
    return false;
  }

  function setAwayHint(text) {
    if (!els.awayHint) return;
    if (text) {
      els.awayHint.textContent = text;
      els.awayHint.hidden = false;
    } else {
      els.awayHint.hidden = true;
      els.awayHint.textContent = "";
    }
  }

  async function registerNativePushBridge() {
    if (!isAuraAndroidTwa()) return false;
    if (typeof firebase === "undefined" || !firebase.auth) return false;
    var user = firebase.auth().currentUser;
    if (!user) return false;

    var idToken = await user.getIdToken();
    var resp = await fetch(getApiBase() + "/api/native-push-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + idToken,
      },
      body: "{}",
    });
    if (!resp.ok) return false;
    var data = await resp.json();
    if (!data || !data.nonce) return false;

    try {
      sessionStorage.setItem("auraPushOnboardingDismissed", "1");
    } catch (_) {}

    global.location.href =
      "/native-push-bridge.html?nonce=" + encodeURIComponent(data.nonce);
    return true;
  }

  async function refreshWebPushToken(messaging, swReg, vapidKey) {
    if (isAuraAndroidTwa()) return;
    try {
      var token = await messaging.getToken({
        vapidKey: vapidKey,
        serviceWorkerRegistration: swReg || undefined,
      });
      if (token) await saveTokenIfNew(token);
    } catch (_) {}
  }

  async function saveTokenIfNew(token) {
    if (isAuraAndroidTwa()) return;
    var ref = state.db.ref(state.userPath + "/pushTokens");
    var snap = await ref.once("value");
    var val = snap.val() || {};

    // Един запис на браузър/телефон — toggle на известия обновява, не добавя нов токен.
    var deviceKey = null;
    try {
      deviceKey = localStorage.getItem("auraPushDeviceKey");
      if (!deviceKey) {
        deviceKey =
          "dev_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 10);
        localStorage.setItem("auraPushDeviceKey", deviceKey);
      }
    } catch (_) {
      deviceKey = "dev_fallback";
    }

    var prevToken = null;
    try {
      prevToken = localStorage.getItem("auraPushToken");
    } catch (_) {}

    // Премахни стари/дублирани записи (legacy push IDs и стар токен на това устройство).
    Object.keys(val).forEach(function (k) {
      var row = val[k];
      if (!row || !row.token) return;
      if (k === "native_android" || k === deviceKey) return;
      if (row.token === token) {
        ref.child(k).remove().catch(function () {});
        return;
      }
      if (/^-[A-Za-z0-9_]+$/.test(k) || row.token === prevToken) {
        ref.child(k).remove().catch(function () {});
      }
    });

    await ref.child(deviceKey).set({
      token: token,
      platform: "web",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
    });
    try {
      localStorage.setItem("auraPushToken", token);
    } catch (_) {}
  }

  async function registerPush(opts) {
    opts = opts || {};
    var useNative = isAuraAndroidTwa() && !opts.forceWeb;

    if (!useNative && !isSupported()) {
      state.status = "unsupported";
      state.message = (global.authT && global.authT("push.unsupported")) || "Push not supported.";
      notify();
      return false;
    }

    var vapidKey = getVapidKey();
    if (!useNative && !vapidKey) {
      state.status = "error";
      state.message =
        (global.authT && global.authT("push.noVapid")) ||
        "FIREBASE_VAPID_KEY missing.";
      notify();
      return false;
    }

    var permission = Notification.permission;
    if (permission === "default" && !opts.skipPermissionRequest && !useNative) {
      if (state.overlayMode !== "away") hideOverlay();
      permission = await Notification.requestPermission();
    }

    if (useNative) {
      if (!opts.userInitiated) {
        return !!(await hasServerPushToken());
      }
      try {
        var linked = await ensureNativePushLinked();
        if (linked) {
          setOnboardingDismissed();
          hideOverlay();
          notify();
          return true;
        }
        if (opts.skipBridgeFallback) {
          notify();
          return false;
        }
        setPushHint(
          (global.authT && global.authT("push.registering")) ||
            "Registering notifications…"
        );
        var nativeOk = await registerNativePushBridge();
        if (state.db && state.userPath) {
          var alertRef = state.db.ref(state.userPath + "/settings/alertSoundEnabled");
          var alertSnap = await alertRef.once("value");
          if (alertSnap.val() === null) {
            await alertRef.set(true);
          }
        }
        if (!nativeOk) {
          state.status = "error";
          state.message =
            (global.authT && global.authT("push.nativeFailed")) ||
            "Could not register phone alerts. Try again in a few seconds.";
          setPushHint(state.message);
          notify();
          return false;
        }
        setOnboardingDismissed();
        hideOverlay();
        notify();
        return true;
      } catch (nativeErr) {
        state.status = "error";
        var errMsg = nativeErr && nativeErr.message ? nativeErr.message : "";
        if (/failed to fetch|networkerror|load failed/i.test(errMsg)) {
          state.message =
            (global.authT && global.authT("push.serverUnreachable")) ||
            "Cannot reach the server. Close the app, reopen it, and try again.";
        } else {
          state.message = errMsg || "Native push registration failed.";
        }
        setPushHint(state.message);
        notify();
        return false;
      }
    }

    if (permission !== "granted") {
      state.status = "denied";
      state.message = (global.authT && global.authT("push.denied")) || "Notifications denied.";
      setPushHint(state.message);
      notify();
      return false;
    }

    try {
      var messaging = firebase.messaging();
      var swReg = await registerServiceWorker();

      if (
        swReg &&
        "serviceWorker" in navigator &&
        !navigator.serviceWorker.controller
      ) {
        if (!sessionStorage.getItem("swReloadedOnce")) {
          sessionStorage.setItem("swReloadedOnce", "1");
          await navigator.serviceWorker.ready;
          global.location.reload();
          return false;
        }
      }

      bindForegroundHandler(messaging);

      global.document.addEventListener("visibilitychange", function () {
        if (global.document.visibilityState !== "visible") return;
        refreshWebPushToken(messaging, swReg, vapidKey);
      });

      var token = await messaging.getToken({
        vapidKey: vapidKey,
        serviceWorkerRegistration: swReg || undefined,
      });

      if (!token) {
        state.status = "error";
        state.message = (global.authT && global.authT("push.tokenFailed")) || "Token failed.";
        notify();
        return false;
      }

      await saveTokenIfNew(token);
      if (state.db && state.userPath) {
        var settingsRef = state.db.ref(state.userPath + "/settings/alertSoundEnabled");
        var settingsSnap = await settingsRef.once("value");
        if (settingsSnap.val() === null) {
          await settingsRef.set(true);
        }
      }
      markRegistered();
      state.status = "active";
      state.message = "";
      notify();
      return true;
    } catch (e) {
      state.status = "error";
      state.message =
        (global.authT &&
          global.authT("push.registerError", {
            message: e.message || "registration failed",
          })) ||
        "Error: " + (e.message || "registration failed");
      notify();
      return false;
    }
  }

  function setOverlayMode(mode) {
    state.overlayMode = mode;
    if (!els.overlay) return;

    var show = !!mode;
    els.overlay.hidden = !show;
    els.overlay.setAttribute("aria-hidden", show ? "false" : "true");
    global.document.body.classList.toggle("dashboard-overlay-open", show);

    if (els.onboardingDialog) {
      els.onboardingDialog.hidden = mode !== "onboarding";
    }
    if (els.awayDialog) {
      els.awayDialog.hidden = mode !== "away";
    }
    if (els.dialogHint) {
      if (mode === "onboarding" && state.message) {
        els.dialogHint.textContent = state.message;
        els.dialogHint.hidden = false;
      } else {
        els.dialogHint.hidden = true;
      }
    }
  }

  function hideOverlay() {
    setOverlayMode(null);
  }

  function showOnboardingOverlay() {
    setOverlayMode("onboarding");
  }

  function showAwayOverlay() {
    setOverlayMode("away");
  }

  function updateUi() {
    if (els.chip) {
      var t = global.authT || function (k) { return k; };
      if (state.pushKind === "native" && areAndroidNotificationsEnabled()) {
        els.chip.textContent = t("dashboard.pushNativeActive") || "✓ Native alerts active";
        els.chip.hidden = false;
        els.chip.classList.remove("push-chip-warn");
      } else if (isAuraAndroidTwa() && !areAndroidNotificationsEnabled()) {
        els.chip.textContent =
          t("dashboard.pushNotifyDenied") ||
          "Allow notifications: Settings → Apps → Aura → Notifications";
        els.chip.hidden = false;
        els.chip.classList.add("push-chip-warn");
      } else if (isAuraAndroidTwa() && state.pushKind !== "native") {
        els.chip.textContent =
          t("dashboard.pushNativePending") || "Tap to activate reliable phone alerts";
        els.chip.hidden = false;
        els.chip.classList.add("push-chip-warn");
      } else if (state.status === "active" && state.pushKind === "web") {
        els.chip.textContent = t("dashboard.pushActive");
        els.chip.hidden = false;
        els.chip.classList.remove("push-chip-warn");
      } else {
        els.chip.hidden = true;
      }
    }
    if (
      state.overlayMode === "onboarding" &&
      (state.status === "active" || state.status === "unsupported")
    ) {
      hideOverlay();
    }
  }

  function applyAwayMode() {
    if (!state.db || !state.userPath) return;
    state.db.ref(state.userPath).update({ systemEnabled: true });
    state.pendingAway = false;
    hideOverlay();
  }

  function shouldShowOnboardingOnLogin() {
    if (!isSupported() && !isAuraAndroidTwa()) return false;
    if (isActive()) return false;
    if (Notification.permission === "denied" && !isAuraAndroidTwa()) return false;
    if (onboardingDismissed()) return false;
    return true;
  }

  function cacheElements() {
    els.overlay = document.getElementById("pushOverlay");
    els.onboardingDialog = document.getElementById("pushOnboardingDialog");
    els.awayDialog = document.getElementById("pushAwayDialog");
    els.dialogHint = document.getElementById("pushDialogHint");
    els.chip = document.getElementById("pushChip");
    els.overlayYes = document.getElementById("pushOverlayYes");
    els.overlayNo = document.getElementById("pushOverlayNo");
    els.awayEnable = document.getElementById("pushAwayEnable");
    els.awaySkip = document.getElementById("pushAwaySkip");
    els.awayCancel = document.getElementById("pushAwayCancel");
    els.awayHint = document.getElementById("pushAwayHint");
  }

  function bindUi() {
    if (els.chip) {
      els.chip.style.cursor = "pointer";
      els.chip.addEventListener("click", function () {
        if (isAuraAndroidTwa() && !areAndroidNotificationsEnabled()) {
          openAndroidNotificationSettings();
          return;
        }
        if (isAuraAndroidTwa() && state.pushKind !== "native") {
          ensureNativePushLinked();
        }
      });
    }
    if (els.overlayYes) {
      els.overlayYes.addEventListener("click", function () {
        els.overlayYes.disabled = true;
        setOnboardingDismissed();
        setPushHint(
          (global.authT && global.authT("push.registering")) ||
            "Registering notifications…"
        );
        registerPush({ userInitiated: true }).then(function (ok) {
          els.overlayYes.disabled = false;
          if (ok) {
            hideOverlay();
            if (state.pendingAway) applyAwayMode();
          } else if (state.message) {
            setPushHint(state.message);
          }
        });
      });
    }
    if (els.overlayNo) {
      els.overlayNo.addEventListener("click", function () {
        setOnboardingDismissed();
        hideOverlay();
        if (state.pendingAway) {
          state.pendingAway = false;
        }
      });
    }
    if (els.awayEnable) {
      els.awayEnable.addEventListener("click", function () {
        els.awayEnable.disabled = true;
        setAwayHint(
          (global.authT && global.authT("push.linking")) || "Linking phone alerts…"
        );
        registerPush({ userInitiated: true, skipBridgeFallback: true })
          .then(function (ok) {
            els.awayEnable.disabled = false;
            if (ok) {
              applyAwayMode();
              return;
            }
            setAwayHint(
              (global.authT && global.authT("push.awayPushFailed")) ||
                "Alerts not linked yet. Away mode is on — reopen the app and tap the yellow text."
            );
            applyAwayMode();
          })
          .catch(function () {
            els.awayEnable.disabled = false;
            applyAwayMode();
          });
      });
    }
    if (els.awaySkip) {
      els.awaySkip.addEventListener("click", function () {
        applyAwayMode();
      });
    }
    if (els.awayCancel) {
      els.awayCancel.addEventListener("click", function () {
        state.pendingAway = false;
        hideOverlay();
      });
    }
  }

  async function init(options) {
    state.userPath = options.userPath;
    state.db = options.db;
    state.onStateChange = options.onStateChange || null;
    cacheElements();
    bindUi();
    captureDeviceId();

    if (!isSupported() && !isAuraAndroidTwa()) {
      state.status = "unsupported";
      notify();
      return;
    }

    await syncPushStatusFromServer();

    if (isAuraAndroidTwa()) {
      var userKeyFromPath = (state.userPath || "").replace(/^users\//, "");
      if (userKeyFromPath) {
        syncNativeUserKeyToApp(userKeyFromPath);
      }
      if (state.pushKind !== "native") {
        await removeWebPushTokensOnTwa();
        await syncPushStatusFromServer();
      }
      if (state.pushKind !== "native") {
        ensureNativePushLinked().catch(function () {});
      } else {
        linkNativeDevice().catch(function () {});
      }
    }

    if (state.status === "active") {
      if (!isAuraAndroidTwa() && Notification.permission === "granted") {
        registerPush({ skipPermissionRequest: true }).catch(function () {});
      }
      return;
    }

    state.status = "pending";
    notify();

    if (Notification.permission === "granted" && !isAuraAndroidTwa()) {
      var ok = await registerPush({ skipPermissionRequest: true });
      if (ok) return;
    }

    if (Notification.permission === "denied" && !isAuraAndroidTwa()) {
      state.status = "denied";
      notify();
      return;
    }

    if (shouldShowOnboardingOnLogin()) {
      showOnboardingOverlay();
    }

    if (!state.visibilityBound) {
      state.visibilityBound = true;
      global.document.addEventListener("visibilitychange", function () {
        if (global.document.visibilityState !== "visible") return;
        captureDeviceId();
        try {
          var params = new URLSearchParams(global.location.search || "");
          var notify = params.get("aura_notify");
          if (notify === "1" || notify === "0") {
            localStorage.setItem("auraNotifyOk", notify);
          }
        } catch (_) {}
      syncPushStatusFromServer().then(function (has) {
        if (has) {
          setOnboardingDismissed();
          hideOverlay();
          if (state.pendingAway) applyAwayMode();
        } else if (isAuraAndroidTwa()) {
          linkNativeDevice().then(function () {
            syncPushStatusFromServer();
          });
        }
      });
      });
    }
  }

  async function requestAwayModeWithPush() {
    if (!(await hasServerPushToken())) {
      clearRegisteredLocally();
      state.status = "pending";
      notify();
    } else if (!isActive()) {
      state.status = "active";
      markRegistered();
      notify();
      return true;
    }

    if (isActive()) return true;
    state.pendingAway = true;
    showAwayOverlay();
    return false;
  }

  global.AuraPush = {
    init: init,
    isActive: isActive,
    registerPush: registerPush,
    requestAwayModeWithPush: requestAwayModeWithPush,
    syncNativeUserKeyToApp: syncNativeUserKeyToApp,
    getState: function () {
      return state;
    },
  };
})(window);
