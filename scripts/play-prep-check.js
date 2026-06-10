/**
 * Проверка преди Google Play / PWA Builder.
 * Стартирай: npm run play:check
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const errors = [];
const warnings = [];

function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
}

const requiredFiles = [
    "manifest.json",
    "icons/icon-192.png",
    "icons/icon-512.png",
    ".well-known/assetlinks.json",
    "play-store/feature-graphic-1024x500.png",
    "privacy.html",
    "delete-account.html",
    "sw.js",
    "firebase-messaging-sw.js",
    "pwa-register.js",
];

requiredFiles.forEach((f) => {
    if (!exists(f)) errors.push("Липсва файл: " + f);
});

const htmlPages = [
    "index.html",
    "login.html",
    "register.html",
    "dashboard.html",
    "privacy.html",
    "impressum.html",
    "delete-account.html",
];

htmlPages.forEach((page) => {
    if (!exists(page)) {
        errors.push("Липсва: " + page);
        return;
    }
    const html = read(page);
    if (!html.includes('rel="manifest"')) {
        errors.push(page + ": няма <link rel=\"manifest\">");
    }
    if (!html.includes('name="theme-color"')) {
        warnings.push(page + ": няма theme-color meta");
    }
});

try {
    const manifest = JSON.parse(read("manifest.json"));
    if (!manifest.name || !manifest.icons || manifest.icons.length < 2) {
        errors.push("manifest.json: липсват name или icons");
    }
    if (manifest.display !== "standalone") {
        warnings.push('manifest.json: display не е "standalone"');
    }
} catch (e) {
    errors.push("manifest.json: невалиден JSON – " + e.message);
}

try {
    const links = JSON.parse(read(".well-known/assetlinks.json"));
    const fp = links[0]?.target?.sha256_cert_fingerprints?.[0] || "";
    if (fp.includes("PASTE_SHA256")) {
        warnings.push(
            "assetlinks.json: попълни SHA-256 след като сглобиш AAB (виж PLAY_STORE.md стъпка 5)"
        );
    }
    const pkg = links[0]?.target?.package_name;
    if (pkg !== "com.aurahomesystems.app") {
        warnings.push("assetlinks.json: package_name е " + pkg);
    }
} catch (e) {
    errors.push("assetlinks.json: " + e.message);
}

console.log("=== Google Play / PWA проверка ===\n");
if (warnings.length) {
    console.log("Предупреждения:");
    warnings.forEach((w) => console.log("  ⚠ " + w));
    console.log("");
}
if (errors.length) {
    console.log("Грешки:");
    errors.forEach((e) => console.log("  ✗ " + e));
    process.exit(1);
}
console.log("✓ Основните файлове и HTML са наред.");
console.log("\nСледващи стъпки (ръчно):");
console.log("  1. Качи сайта на https://aurahomesystems.eu (HTTPS)");
console.log("  2. https://www.pwabuilder.com → URL на сайта → Package for stores → Android");
console.log("  3. Package ID: com.aurahomesystems.app → Generate → Android Studio → .aab");
console.log("  4. SHA-256 в .well-known/assetlinks.json + повторно качване на сайта");
console.log("  5. Play Console → качи .aab, store listing (play-store-listing.txt)");
