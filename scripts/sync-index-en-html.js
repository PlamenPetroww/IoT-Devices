/**
 * One-shot: set index.html default visible text from translations.en (for Google crawlers).
 */
const fs = require("fs");
const path = require("path");

const translations = new Function(
    "return " +
        fs
            .readFileSync(path.join(__dirname, "..", "translations.js"), "utf8")
            .replace(/^const translations = /, "")
            .replace(/;\s*function getTranslation[\s\S]*/, "")
)();

function getTranslation(lang, key) {
    const parts = key.split(".");
    let cur = translations[lang];
    for (const part of parts) {
        if (!cur || typeof cur !== "object") return null;
        cur = cur[part];
    }
    return typeof cur === "string" ? cur : null;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

const indexPath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(indexPath, "utf8");

html = html.replace(
    /(<([a-zA-Z0-9]+)([^>]*?)data-i18n-html="([^"]+)"([^>]*)\s*>)([\s\S]*?)(<\/\2\s*>)/g,
    function (_match, open, _tag, _before, key, _after, _content, close) {
        const t = getTranslation("en", key);
        if (!t) return _match;
        return open + t + close;
    }
);

html = html.replace(
    /(<([a-zA-Z0-9]+)([^>]*?)data-i18n="([^"]+)"([^>]*)\s*>)([\s\S]*?)(<\/\2\s*>)/g,
    function (_match, open, _tag, _before, key, _after, content, close) {
        if (/<[a-zA-Z]/.test(content)) return _match;
        const t = getTranslation("en", key);
        if (!t) return _match;
        return open + t + close;
    }
);

html = html.replace(
    /(<[^>]+data-i18n-placeholder="([^"]+)"[^>]*)(\/?>)/g,
    function (_match, start, key, end) {
        const t = getTranslation("en", key);
        if (!t) return _match;
        const el = start.replace(/\splaceholder="[^"]*"/g, "");
        return el + ' placeholder="' + escapeHtml(t) + '"' + end;
    }
);

html = html.replace(
    /(<[^>]+data-i18n-aria-label="([^"]+)"[^>]*)(\/?>)/g,
    function (_match, start, key, end) {
        const t = getTranslation("en", key);
        if (!t) return _match;
        const el = start.replace(/\saria-label="[^"]*"/g, "");
        return el + ' aria-label="' + escapeHtml(t) + '"' + end;
    }
);

fs.writeFileSync(indexPath, html, "utf8");
console.log("Synced index.html defaults to English from translations.en");
