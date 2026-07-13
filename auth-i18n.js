function getAuraLang() {
    try {
        const lang = localStorage.getItem("aura-lang") || "en";
        return translations[lang] ? lang : "en";
    } catch (_) {
        return "en";
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
    if (lang === "bg") return "bg";
    if (lang === "de") return "de";
    return "en";
}

function auraDateLocale() {
    const lang = getAuraLang();
    if (lang === "bg") return "bg-BG";
    if (lang === "de") return "de-DE";
    return "en-GB";
}

var auraLangPickerBound = false;
var headerMenuLangBound = false;

function langDropdownInnerHtml() {
    return (
        '<div class="lang-dropdown">' +
        '<button type="button" class="lang-dropdown-trigger" aria-haspopup="true" aria-expanded="false" id="langDropdownTrigger">' +
        '<span class="lang-flag-icon lang-flag-en" id="langTriggerFlag"></span>' +
        '<span class="lang-code" id="langTriggerCode">EN</span>' +
        '<span class="lang-chevron" aria-hidden="true">▼</span>' +
        "</button>" +
        '<div class="lang-dropdown-menu" id="langDropdownMenu" role="menu" hidden>' +
        '<button type="button" class="lang-option" data-lang="en" role="menuitem">' +
        '<span class="lang-flag-icon lang-flag-en"></span> EN</button>' +
        '<button type="button" class="lang-option" data-lang="bg" role="menuitem">' +
        '<span class="lang-flag-icon lang-flag-bg"></span> BG</button>' +
        '<button type="button" class="lang-option" data-lang="de" role="menuitem">' +
        '<span class="lang-flag-icon lang-flag-de"></span> DE</button>' +
        "</div></div>"
    );
}

function ensureLangDropdown() {
    var menuLang = document.getElementById("headerMenuLang");
    if (menuLang) {
        updateLangDropdownUi(getAuraLang());
        initHeaderMenuLangPicker();
        return;
    }
    if (document.querySelector(".lang-dropdown")) {
        updateLangDropdownUi(getAuraLang());
        initAuraLangPicker();
        return;
    }
    var mount = document.createElement("div");
    mount.innerHTML = langDropdownInnerHtml();
    var dropdown = mount.firstElementChild;
    if (!dropdown) return;

    if (document.body.classList.contains("auth-page")) {
        var bar = document.createElement("div");
        bar.className = "auth-lang-bar";
        bar.appendChild(dropdown);
        document.body.appendChild(bar);
    } else {
        return;
    }
    updateLangDropdownUi(getAuraLang());
    initAuraLangPicker();
}

function initHeaderMenuLangPicker() {
    if (headerMenuLangBound) return;
    var buttons = document.querySelectorAll(".header-menu-lang-btn[data-lang]");
    if (!buttons.length) return;
    headerMenuLangBound = true;
    buttons.forEach(function (btn) {
        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            applyAuraLanguage(btn.getAttribute("data-lang"));
        });
    });
}

function updateLangDropdownUi(lang) {
    var codes = { bg: "BG", en: "EN", de: "DE" };
    var triggerFlag = document.getElementById("langTriggerFlag");
    var triggerCode = document.getElementById("langTriggerCode");
    if (triggerFlag) {
        triggerFlag.className =
            "lang-flag-icon lang-flag-" + (lang === "bg" ? "bg" : lang === "de" ? "de" : "en");
    }
    if (triggerCode) triggerCode.textContent = codes[lang] || codes.en;
    document.querySelectorAll(".lang-option").forEach(function (opt) {
        opt.classList.toggle("active", opt.getAttribute("data-lang") === lang);
    });
    document.querySelectorAll(".header-menu-lang-btn[data-lang]").forEach(function (btn) {
        btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
    var trigger = document.getElementById("langDropdownTrigger");
    if (trigger) {
        trigger.setAttribute("aria-label", getTranslation(lang, "nav.language") || "Language");
    }
}

function applyAuraLanguage(lang) {
    if (!translations[lang]) lang = "en";
    try {
        localStorage.setItem("aura-lang", lang);
    } catch (_) {}
    updateLangDropdownUi(lang);
    try {
        window.dispatchEvent(new CustomEvent("aura-lang-applied", { detail: { lang: lang } }));
    } catch (_) {}
}

function initAuraLangPicker() {
    if (auraLangPickerBound) return;
    var dropdown = document.querySelector(".lang-dropdown");
    var trigger = document.getElementById("langDropdownTrigger");
    var menu = document.getElementById("langDropdownMenu");
    if (!dropdown || !trigger || !menu) return;
    auraLangPickerBound = true;

    trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        dropdown.classList.toggle("open");
        var open = dropdown.classList.contains("open");
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        menu.hidden = !open;
    });

    document.querySelectorAll(".lang-option").forEach(function (btn) {
        btn.addEventListener("click", function () {
            applyAuraLanguage(btn.getAttribute("data-lang"));
            dropdown.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            menu.hidden = true;
        });
    });

    document.addEventListener("click", function (e) {
        if (e.target.closest(".lang-dropdown")) return;
        dropdown.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        menu.hidden = true;
    });
}

function initAuthI18n(page) {
    const lang = getAuraLang();
    document.documentElement.lang =
        lang === "de" ? "de" : lang === "bg" ? "bg" : "en";

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

    ensureLangDropdown();
}

if (typeof window !== "undefined") {
    window.getAuraLang = getAuraLang;
    window.authT = authT;
    window.auraDateLocale = auraDateLocale;
    window.applyAuraLanguage = applyAuraLanguage;
    window.initAuthI18n = initAuthI18n;
    window.addEventListener("aura-lang-applied", function () {
        var page = document.body && document.body.dataset.i18nPage;
        if (page) initAuthI18n(page);
        else if (document.body && document.body.classList.contains("auth-page")) {
            initAuthI18n(document.body.dataset.i18nPage || "login");
        }
    });
}
