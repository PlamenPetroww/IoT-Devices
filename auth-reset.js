/**
 * Възстановяване на парола – каноничен URL и извличане на oobCode от Firebase линка.
 */
(function (global) {
  "use strict";

  var PRODUCTION_ORIGIN = "https://aurahomesystems.eu";

  function getAuthSiteOrigin() {
    var host = global.location.hostname;
    if (host === "aurahomesystems.eu" || host === "www.aurahomesystems.eu") {
      return PRODUCTION_ORIGIN;
    }
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return global.location.protocol + "//" + global.location.host;
    }
    return PRODUCTION_ORIGIN;
  }

  function getPasswordResetHandlerUrl() {
    return getAuthSiteOrigin() + "/reset-password.html";
  }

  function extractPasswordResetCode(loc) {
    loc = loc || global.location;
    var search = new URLSearchParams(loc.search || "");
    var code = search.get("oobCode");
    if (code) return code;

    var mode = search.get("mode");
    if (mode === "resetPassword") {
      code = search.get("oobCode");
      if (code) return code;
    }

    var hash = (loc.hash || "").replace(/^#/, "");
    if (hash) {
      if (hash.indexOf("oobCode=") !== -1) {
        var hashParams = new URLSearchParams(hash);
        code = hashParams.get("oobCode");
        if (code) return code;
      }
    }
    return null;
  }

  function redirectToResetPageIfCodePresent() {
    var code = extractPasswordResetCode();
    if (!code) return false;
    var target = getPasswordResetHandlerUrl();
    if (global.location.pathname.indexOf("reset-password") !== -1) return false;
    var url = target + "?oobCode=" + encodeURIComponent(code);
    var mode = new URLSearchParams(global.location.search).get("mode");
    if (mode) url += "&mode=" + encodeURIComponent(mode);
    global.location.replace(url);
    return true;
  }

  global.AuraAuthReset = {
    getAuthSiteOrigin: getAuthSiteOrigin,
    getPasswordResetHandlerUrl: getPasswordResetHandlerUrl,
    extractPasswordResetCode: extractPasswordResetCode,
    redirectToResetPageIfCodePresent: redirectToResetPageIfCodePresent,
  };
})(window);
