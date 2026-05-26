function getAuraLang() {
    try {
        const lang = localStorage.getItem("aura-lang") || "bg";
        return translations[lang] ? lang : "bg";
    } catch (_) {
        return "bg";
    }
}

function authT(key) {
    return getTranslation(getAuraLang(), key) || "";
}

function firebaseAuthLang() {
    const lang = getAuraLang();
    if (lang === "en") return "en";
    if (lang === "de") return "de";
    return "bg";
}

function initAuthI18n(page) {
    const lang = getAuraLang();
    document.documentElement.lang =
        lang === "de" ? "de" : lang === "en" ? "en" : "bg";

    const titleKey =
        page === "register"
            ? "auth.registerPageTitle"
            : page === "reset"
              ? "auth.resetPageTitle"
              : "auth.loginPageTitle";
    const title = getTranslation(lang, titleKey);
    if (title) document.title = title;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        const t = getTranslation(lang, key);
        if (t) el.textContent = t;
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("placeholder", t);
    });
}
