function getAuraLang() {
    try {
        const lang = localStorage.getItem("aura-lang") || "bg";
        return translations[lang] ? lang : "bg";
    } catch (_) {
        return "bg";
    }
}

function authT(key, vars) {
    var text = getTranslation(getAuraLang(), key) || "";
    if (vars && typeof vars === "object") {
        Object.keys(vars).forEach(function (k) {
            text = text.split("{" + k + "}").join(String(vars[k]));
        });
    }
    return text;
}

function firebaseAuthLang() {
    const lang = getAuraLang();
    if (lang === "en") return "en";
    if (lang === "de") return "de";
    return "bg";
}

function auraDateLocale() {
    const lang = getAuraLang();
    if (lang === "en") return "en-GB";
    if (lang === "de") return "de-DE";
    return "bg-BG";
}

function initAuthI18n(page) {
    const lang = getAuraLang();
    document.documentElement.lang =
        lang === "de" ? "de" : lang === "en" ? "en" : "bg";

    const titleKeys = {
        register: "auth.registerPageTitle",
        reset: "auth.resetPageTitle",
        dashboard: "dashboard.pageTitle",
        delete: "deleteAccount.pageTitle",
    };
    const titleKey = titleKeys[page] || "auth.loginPageTitle";
    const title = getTranslation(lang, titleKey);
    if (title) document.title = title;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        const t = getTranslation(lang, key);
        if (t) el.textContent = t;
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
        const key = el.getAttribute("data-i18n-html");
        const t = getTranslation(lang, key);
        if (t) el.innerHTML = t;
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("placeholder", t);
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
        const key = el.getAttribute("data-i18n-aria");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("aria-label", t);
    });
}

if (typeof window !== "undefined") {
    window.getAuraLang = getAuraLang;
    window.authT = authT;
    window.auraDateLocale = auraDateLocale;
    window.initAuthI18n = initAuthI18n;
    window.addEventListener("aura-lang-applied", function () {
        var page = document.body && document.body.dataset.i18nPage;
        if (page) initAuthI18n(page);
    });
}
