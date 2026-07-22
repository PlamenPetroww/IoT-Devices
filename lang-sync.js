(function (global) {
  "use strict";

  function getSafeEmail(email) {
    if (!email) return "";
    return email
      .trim()
      .toLowerCase()
      .replace(/\./g, "-")
      .replace(/@/g, "_at_");
  }

  function normalizeLang(lang) {
    if (lang === "bg" || lang === "de" || lang === "en") return lang;
    return "en";
  }

  function syncAuraLangToFirebase(lang) {
    if (typeof firebase === "undefined" || !firebase.auth || !firebase.database) {
      return;
    }
    var user = firebase.auth().currentUser;
    if (!user || !user.email) return;
    var code = normalizeLang(lang);
    if (typeof getAuraLang === "function" && !lang) {
      code = normalizeLang(getAuraLang());
    }
    firebase
      .database()
      .ref("users/" + getSafeEmail(user.email) + "/settings/language")
      .set(code)
      .catch(function () {});
  }

  function initAuraLangSync() {
    syncAuraLangToFirebase();
    global.addEventListener("aura-lang-applied", function (e) {
      syncAuraLangToFirebase((e.detail && e.detail.lang) || null);
    });
    if (firebase.auth) {
      firebase.auth().onAuthStateChanged(function (user) {
        if (user) syncAuraLangToFirebase();
      });
    }
  }

  global.AuraLangSync = {
    sync: syncAuraLangToFirebase,
    init: initAuraLangSync,
  };
})(window);
