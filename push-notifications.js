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
          new Notification(title, {
            body: body,
            icon: "/favicon.png",
            silent: !playSound,
          });
        }
        if (playSound) playAlertSound();
      } catch (err) {
        console.warn("[push] Foreground notification failed:", err);
      }
    });
  }

  async function saveTokenIfNew(token) {
    var ref = state.db.ref(state.userPath + "/pushTokens");
    var snap = await ref.once("value");
    var val = snap.val() || {};
    var exists = Object.keys(val).some(function (k) {
      return val[k] && val[k].token === token;
    });
    if (!exists) {
      await ref.push({
        token: token,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      });
    }
  }

  async function registerPush(opts) {
    opts = opts || {};
    if (!isSupported()) {
      state.status = "unsupported";
      state.message = "Браузърът не поддържа push известия.";
      notify();
      return false;
    }

    var vapidKey = getVapidKey();
    if (!vapidKey) {
      state.status = "error";
      state.message =
        "Липсва FIREBASE_VAPID_KEY в firebase-config.js (Firebase → Cloud Messaging).";
      notify();
      return false;
    }

    var permission = Notification.permission;
    if (permission === "default" && !opts.skipPermissionRequest) {
      hideOverlay();
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      state.status = "denied";
      state.message = "Известията са изключени в настройките на телефона.";
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

      var token = await messaging.getToken({
        vapidKey: vapidKey,
        serviceWorkerRegistration: swReg || undefined,
      });

      if (!token) {
        state.status = "error";
        state.message = "Неуспешно получаване на токен за известия.";
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
      state.message = "Грешка: " + (e.message || "неуспешна регистрация");
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
      els.chip.hidden = state.status !== "active";
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
    if (!isSupported()) return false;
    if (isActive()) return false;
    if (Notification.permission === "denied") return false;
    if (onboardingDismissed()) return false;
    if (Notification.permission === "granted" && wasRegisteredLocally()) return false;
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
  }

  function bindUi() {
    if (els.overlayYes) {
      els.overlayYes.addEventListener("click", function () {
        registerPush().then(function (ok) {
          if (ok && state.pendingAway) applyAwayMode();
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
        registerPush().then(function (ok) {
          if (ok) applyAwayMode();
          else if (state.message && els.dialogHint && state.overlayMode === "away") {
            els.dialogHint.textContent = state.message;
            els.dialogHint.hidden = false;
          }
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

    if (!isSupported()) {
      state.status = "unsupported";
      notify();
      return;
    }

    if (Notification.permission === "granted") {
      state.status = wasRegisteredLocally() ? "active" : "pending";
      notify();
      var ok = await registerPush({ skipPermissionRequest: true });
      if (!ok && shouldShowOnboardingOnLogin()) {
        showOnboardingOverlay();
      }
      return;
    }

    if (Notification.permission === "denied") {
      state.status = "denied";
      notify();
      return;
    }

    state.status = "pending";
    notify();
    if (shouldShowOnboardingOnLogin()) {
      showOnboardingOverlay();
    }
  }

  function requestAwayModeWithPush() {
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
    getState: function () {
      return state;
    },
  };
})(window);
