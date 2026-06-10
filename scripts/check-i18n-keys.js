const fs = require("fs");
const path = require("path");
const translations = new Function(
    "return " +
        fs
            .readFileSync(path.join(__dirname, "..", "translations.js"), "utf8")
            .replace(/^const translations = /, "")
            .replace(/;\s*function getTranslation[\s\S]*/, "")
)();

function flatten(obj, prefix = "") {
    const out = {};
    for (const k of Object.keys(obj)) {
        const key = prefix ? prefix + "." + k : k;
        if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
            Object.assign(out, flatten(obj[k], key));
        } else {
            out[key] = obj[k];
        }
    }
    return out;
}

const bg = flatten(translations.bg);
const en = flatten(translations.en);
const de = flatten(translations.de);

console.log("Keys:", "bg", Object.keys(bg).length, "en", Object.keys(en).length, "de", Object.keys(de).length);

for (const [base, name, other] of [
    [bg, "en", en],
    [bg, "de", de],
    [en, "bg", bg],
    [de, "bg", bg],
]) {
    const missing = Object.keys(base).filter((k) => !(k in other));
    if (missing.length) {
        console.log("\nMissing in " + name + " (" + missing.length + "):");
        missing.forEach((k) => console.log("  " + k));
    }
}
