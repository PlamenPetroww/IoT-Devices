/**
 * Play Store / TWA: app opens login + dashboard only; full site stays in the browser.
 */
(function (global) {
  "use strict";

  var SITE_ORIGIN = "https://aurahomesystems.eu";
  var LOGIN_PATH = "/login.html";

  var ALLOWED_IN_APP = [
    "login.html",
    "register.html",
    "dashboard.html",
    "reset-password.html",
    "delete-account.html",
    "privacy.html",
  ];

  var REDIRECT_TO_LOGIN = ["index.html", "confirm-inquiry.html", "impressum.html"];

  function isStandaloneDisplay() {
    try {
      if (global.matchMedia("(display-mode: standalone)").matches) return true;
      if (global.matchMedia("(display-mode: fullscreen)").matches) return true;
    } catch (_) {}
    return global.navigator.standalone === true;
  }

  function isPlayApp() {
    try {
      var params = new URLSearchParams(global.location.search);
      if (params.get("aura_app") === "1") {
        global.sessionStorage.setItem("aura_play_app", "1");
        return true;
      }
      if (global.sessionStorage.getItem("aura_play_app") === "1") return true;
    } catch (_) {}
    if (isStandaloneDisplay()) {
      try {
        global.sessionStorage.setItem("aura_play_app", "1");
      } catch (_) {}
      return true;
    }
    return false;
  }

  function pageName() {
    var parts = global.location.pathname.split("/").filter(Boolean);
    var last = parts[parts.length - 1];
    if (!last) return "index.html";
    // Netlify Pretty URLs serves register.html as /register — treat it as the same page.
    if (last.indexOf(".") === -1) return last + ".html";
    return last;
  }

  function siteUrl(path) {
    var p = path ? (path.charAt(0) === "/" ? path.slice(1) : path) : "";
    return SITE_ORIGIN + "/" + p;
  }

  function redirectToLogin() {
    global.location.replace(LOGIN_PATH + global.location.search);
  }

  function captureAppMeta() {
    try {
      var params = new URLSearchParams(global.location.search);
      var did = params.get("aura_did");
      if (did) global.localStorage.setItem("auraDeviceId", did);
      var ver = params.get("aura_app_ver");
      if (ver) global.localStorage.setItem("auraAppVersion", ver);
      var notify = params.get("aura_notify");
      if (notify === "1" || notify === "0") {
        global.localStorage.setItem("auraNotifyOk", notify);
      }
    } catch (_) {}
  }

  function getAppVersion() {
    try {
      return global.localStorage.getItem("auraAppVersion") || "";
    } catch (_) {
      return "";
    }
  }

  function showAppVersionUi() {
    if (!playApp) return;
    var ver = getAppVersion();
    if (!ver) return;
    var label =
      (global.authT && global.authT("dashboard.appVersion", { v: ver })) ||
      "App version " + ver;
    var menuEl = global.document.getElementById("appVersionMenu");
    if (menuEl) {
      menuEl.textContent = label;
      menuEl.hidden = false;
    }
    var footerEl = global.document.getElementById("appVersionLine");
    if (footerEl) {
      footerEl.textContent = label;
      footerEl.hidden = false;
    }
  }

  function hideBackToSiteLinks() {
    global.document.querySelectorAll('a.back-home, a[data-i18n="auth.backToSite"]').forEach(function (link) {
      link.hidden = true;
      link.style.display = "none";
      link.setAttribute("aria-hidden", "true");
      var next = link.nextElementSibling;
      if (next && next.classList && next.classList.contains("footer-sep")) {
        next.hidden = true;
        next.style.display = "none";
      }
      var prev = link.previousElementSibling;
      if (prev && prev.tagName === "BR") {
        prev.hidden = true;
        prev.style.display = "none";
      }
    });
  }

  function patchLinks() {
    captureAppMeta();
    global.document.documentElement.classList.add("aura-play-app");

    global.document.querySelectorAll('a[href="index.html"], a[href="/"]').forEach(function (link) {
      if (link.dataset.i18n === "auth.backToSite" || link.classList.contains("back-home")) {
        return;
      }
      if (link.classList.contains("dashboard-brand-link")) {
        link.setAttribute("href", "dashboard.html");
        link.setAttribute("aria-label", (global.authT && global.authT("dashboard.brandShort")) || "Dashboard");
        return;
      }
    });

    hideBackToSiteLinks();

    global.document.querySelectorAll('a[href="impressum.html"]').forEach(function (link) {
      link.setAttribute("href", siteUrl("impressum.html"));
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    });

    showAppVersionUi();
  }

  var playApp = isPlayApp();

  global.AuraAppMode = {
    isPlayApp: function () {
      return playApp;
    },
    getAppVersion: getAppVersion,
    siteUrl: siteUrl,
    openOnWebsite: function (path) {
      global.open(siteUrl(path), "_blank", "noopener,noreferrer");
    },
  };

  if (!playApp) return;

  captureAppMeta();

  var page = pageName();

  if (REDIRECT_TO_LOGIN.indexOf(page) !== -1) {
    redirectToLogin();
    return;
  }

  if (ALLOWED_IN_APP.indexOf(page) === -1) {
    redirectToLogin();
    return;
  }

  if (global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", patchLinks);
  } else {
    patchLinks();
  }
})(window);
