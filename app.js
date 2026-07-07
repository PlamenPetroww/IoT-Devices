function isHomePage() {
    const path = (window.location.pathname || "/").replace(/\/$/, "") || "/";
    return path === "/" || path.endsWith("/index.html") || path.endsWith("index.html");
}

function applySeoMeta(lang) {
    const setMeta = (selector, key, attr) => {
        const el = document.querySelector(selector);
        const val = getTranslation(lang, key);
        if (el && val && val !== key) el.setAttribute(attr, val);
    };

    if (document.querySelector(".installation-page")) {
        document.title = getTranslation(lang, "installation.pageTitle") || document.title;
        setMeta('meta[name="description"]', "installation.metaDescription", "content");
        return;
    }

    if (!isHomePage()) return;

    const pageTitle = getTranslation(lang, "seo.pageTitle");
    if (pageTitle) document.title = pageTitle;

    setMeta('meta[name="description"]', "seo.metaDescription", "content");
    setMeta('meta[property="og:title"]', "seo.ogTitle", "content");
    setMeta('meta[property="og:description"]', "seo.ogDescription", "content");
    setMeta('meta[name="twitter:title"]', "seo.twitterTitle", "content");
    setMeta('meta[name="twitter:description"]', "seo.twitterDescription", "content");

    const ogLocale = document.querySelector('meta[property="og:locale"]');
    if (ogLocale) {
        ogLocale.setAttribute(
            "content",
            lang === "de" ? "de_DE" : lang === "en" ? "en_GB" : "bg_BG"
        );
    }
}

function applyLanguage(lang) {
    if (!translations[lang]) lang = "en";
    document.documentElement.lang = lang === "de" ? "de" : lang === "bg" ? "bg" : "en";

    applySeoMeta(lang);

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
    document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
        const key = el.getAttribute("data-i18n-alt");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("alt", t);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("placeholder", t);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
        const key = el.getAttribute("data-i18n-aria-label");
        const t = getTranslation(lang, key);
        if (t) el.setAttribute("aria-label", t);
    });

    const triggerFlag = document.getElementById("langTriggerFlag");
    const triggerCode = document.getElementById("langTriggerCode");
    const codes = { bg: "BG", en: "EN", de: "DE" };
    if (triggerFlag) {
        triggerFlag.className = "lang-flag-icon lang-flag-" + (lang === "bg" ? "bg" : lang === "en" ? "en" : "de");
    }
    if (triggerCode) triggerCode.textContent = codes[lang] || codes.en;
    document.querySelectorAll(".lang-option").forEach((opt) => {
        opt.classList.toggle("active", opt.getAttribute("data-lang") === lang);
    });
    try {
        if (document.querySelector(".privacy-page")) {
            const pageTitle = getTranslation(lang, "privacy.pageTitle");
            if (pageTitle) document.title = pageTitle;
        } else if (document.querySelector(".impressum-page")) {
            const pageTitle = getTranslation(lang, "impressum.pageTitle");
            if (pageTitle) document.title = pageTitle;
        }
    } catch (_) {}
    try { localStorage.setItem("aura-lang", lang); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("aura-lang-applied", { detail: { lang } })); } catch (_) {}
}

function initI18n() {
    let lang = "en";
    try {
        const params = new URLSearchParams(window.location.search);
        const urlLang = params.get("lang");
        if (urlLang && translations[urlLang]) {
            lang = urlLang;
        } else {
            lang = localStorage.getItem("aura-lang") || "en";
        }
    } catch (_) {}
    applyLanguage(lang);

    const dropdown = document.querySelector(".lang-dropdown");
    const trigger = document.getElementById("langDropdownTrigger");
    const menu = document.getElementById("langDropdownMenu");
    if (!dropdown || !trigger || !menu) return;

    trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
        trigger.setAttribute("aria-expanded", dropdown.classList.contains("open"));
    });

    document.querySelectorAll(".lang-option").forEach((btn) => {
        btn.addEventListener("click", () => {
            applyLanguage(btn.getAttribute("data-lang"));
            dropdown.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
        });
    });

    document.addEventListener("click", (e) => {
        if (e.target.closest(".lang-dropdown")) return;
        dropdown.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
    });
}

function initStatsCounters() {
    const counters = document.querySelectorAll(".stat-number");
    if (!counters.length) return;

    const animateCounter = (el) => {
        const target = parseInt(el.getAttribute("data-target") || "0", 10);
        if (!target || isNaN(target)) return;

        const duration = 1500;
        const startTime = performance.now();

        const step = (now) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const value = Math.round(target * eased);
            el.textContent = value.toString();

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = target.toString();
            }
        };

        requestAnimationFrame(step);
    };

    const observer = new IntersectionObserver(
        (entries, obs) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    animateCounter(entry.target);
                    obs.unobserve(entry.target);
                }
            });
        },
        {
            threshold: 0.6,
        }
    );

    counters.forEach((counter) => observer.observe(counter));
}

function initSmoothScroll() {
    const cta = document.querySelector(".primary-cta");
    const targetSection = document.getElementById("cta");

    if (!cta || !targetSection) return;

    cta.addEventListener("click", () => {
        targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
    });
}

function initFooterYear() {
    const yearEl = document.getElementById("footerYear");
    if (yearEl) {
        yearEl.textContent = new Date().getFullYear().toString();
    }
}

const CONTACT_EMAIL = "solutions.petrov@gmail.com";

// Форма с потвърждение по имейл: задай INQUIRY_FUNCTIONS_BASE_URL в inquiry-config.js (URL на Cloud Functions).
// Ако е празно, формата изпраща директно към Formspree (без потвърждение).
const FORMSPREE_FORM_ID = "xjgakygl";

function showSuccessNotification(title, message) {
    const overlay = document.createElement("div");
    overlay.className = "success-notification-overlay";
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("role", "alert");
    overlay.innerHTML = `
        <div class="success-notification">
            <div class="success-notification-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5"/>
                </svg>
            </div>
            <h3 class="success-notification-title">${escapeHtml(title)}</h3>
            ${message ? `<p class="success-notification-message">${escapeHtml(message)}</p>` : ""}
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("success-notification-visible"));
    const remove = () => {
        overlay.classList.remove("success-notification-visible");
        overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
    };
    setTimeout(remove, 4500);
    overlay.addEventListener("click", remove);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function initContactForm() {
    const form = document.getElementById("contactForm");
    const statusEl = document.getElementById("formStatus");
    const submitBtn = document.getElementById("formSubmitBtn");
    if (!form || !statusEl) return;

    const sensorsInput = document.getElementById("formSensorsTotalInput");
    const sensorsMinus = document.getElementById("formSensorsTotalMinus");
    const sensorsPlus = document.getElementById("formSensorsTotalPlus");
    if (sensorsInput && sensorsMinus && sensorsPlus) {
        sensorsMinus.addEventListener("click", () => {
            let v = parseInt(sensorsInput.value, 10);
            if (!Number.isFinite(v)) v = 0;
            sensorsInput.value = Math.max(0, v - 1);
        });
        sensorsPlus.addEventListener("click", () => {
            let v = parseInt(sensorsInput.value, 10);
            if (!Number.isFinite(v)) v = 0;
            sensorsInput.value = Math.min(99, v + 1);
        });
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const functionsBase = (typeof window !== "undefined" && window.INQUIRY_FUNCTIONS_BASE_URL) ? window.INQUIRY_FUNCTIONS_BASE_URL.trim() : "";
        const useVerifyFlow = !!functionsBase;
        if (!useVerifyFlow && FORMSPREE_FORM_ID === "YOUR_FORMSPREE_FORM_ID") {
            statusEl.textContent = "Настройте FORMSPREE_FORM_ID в app.js или INQUIRY_FUNCTIONS_BASE_URL в inquiry-config.js.";
            statusEl.className = "form-status form-status-error";
            return;
        }

        const origLabel = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.textContent = "...";
        statusEl.textContent = "";
        statusEl.className = "form-status";

        const formData = new FormData(form);
        const lang = document.documentElement.lang || "en";
        const msgSuccess = { bg: "Изпратено! Ще получите отговор на посочения имейл.", en: "Sent! You will get a reply at the email you provided.", de: "Gesendet! Sie erhalten eine Antwort an Ihre E-Mail." };
        const msgError = { bg: "Неуспешно изпращане. Опитайте отново или пишете на solutions.petrov@gmail.com", en: "Send failed. Try again or email solutions.petrov@gmail.com", de: "Senden fehlgeschlagen. Bitte erneut versuchen oder an solutions.petrov@gmail.com schreiben." };
        const msgSuccessTitle = { bg: "Имейлът е изпратен!", en: "Email sent!", de: "E-Mail gesendet!" };
        const msgVerifyTitle = { bg: "Проверете имейла си", en: "Check your email", de: "E-Mail prüfen" };
        const msgVerifyText = {
            bg: "Изпратихме ви имейл за потвърждение. Моля, проверете пощата си и кликнете на линка в писмото – след това ще получим запитването и ще ви отговорим.",
            en: "We sent you a confirmation email. Please check your inbox and click the link in the email – then we will receive your inquiry and reply.",
            de: "Wir haben Ihnen eine Bestätigungs-E-Mail geschickt. Bitte prüfen Sie Ihren Posteingang und klicken Sie auf den Link – dann erhalten wir Ihre Anfrage und antworten."
        };

        try {
            if (useVerifyFlow) {
                const email = form.querySelector('input[name="_replyto"]').value.trim();
                const subject = form.querySelector('input[name="_subject"]').value.trim();
                const message = form.querySelector('textarea[name="message"]').value.trim();
                const phone = (form.querySelector('input[name="phone"]') && form.querySelector('input[name="phone"]').value) || "";
                const sensorsTotal = (form.querySelector('input[name="sensorsTotal"]') && form.querySelector('input[name="sensorsTotal"]').value) || "0";
                const baseUrl = window.location.origin + (window.location.pathname || "").replace(/[^/]+$/, "").replace(/\/$/, "");
                const res = await fetch(functionsBase.replace(/\/$/, "") + "/submitInquiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, subject, message, phone, sensorsTotal, baseUrl })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    statusEl.textContent = "";
                    statusEl.className = "form-status";
                    form.reset();
                    showSuccessNotification(msgVerifyTitle[lang] || msgVerifyTitle.en, msgVerifyText[lang] || msgVerifyText.en);
                } else {
                    statusEl.textContent = data.error || msgError[lang] || msgError.en;
                    statusEl.className = "form-status form-status-error";
                }
            } else {
                const res = await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
                    method: "POST",
                    body: formData,
                    headers: { Accept: "application/json" }
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && (data.ok === true || res.status === 200)) {
                    statusEl.textContent = "";
                    statusEl.className = "form-status";
                    form.reset();
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.en);
                } else {
                    statusEl.textContent = msgError[lang] || msgError.en;
                    statusEl.className = "form-status form-status-error";
                }
            }
        } catch (err) {
            statusEl.textContent = msgError[lang] || msgError.en;
            statusEl.className = "form-status form-status-error";
        }
        submitBtn.disabled = false;
        submitBtn.textContent = origLabel;
    });
}

function initBuyPanel() {
    const overlay = document.getElementById("buyPanelOverlay");
    const panel = document.getElementById("buyPanel");
    const openBtn = document.getElementById("openBuyPanelBtn");
    const closeBtn = document.getElementById("closeBuyPanelBtn");
    const qtyInput = document.getElementById("buyQtyInput");
    const qtyMinus = document.getElementById("buyQtyMinus");
    const qtyPlus = document.getElementById("buyQtyPlus");
    const summaryQty = document.getElementById("buySummaryQty");
    const summarySubtotal = document.getElementById("buySummarySubtotal");
    const summaryTotal = document.getElementById("buySummaryTotal");
    const buyForm = document.getElementById("buyPanelForm");
    const buyStatus = document.getElementById("buyPanelStatus");
    const buySubmitBtn = document.getElementById("buyPanelSubmitBtn");
    const paymentSelect = buyForm ? buyForm.querySelector('select[name="paymentMethod"]') : null;
    const revolutField = document.getElementById("revolutField");
    const shippingZoneSelect = document.getElementById("buyShippingZone");
    const shippingMethodSelect = document.getElementById("buyShippingMethod");
    const shippingMethodWrap = document.getElementById("buyShippingMethodWrap");
    const deliveryPriceDaysEl = document.getElementById("buySummaryDeliveryPriceDays");
    const deliveryCountrySelect = document.getElementById("buyDeliveryCountry");
    if (!overlay || !panel || !openBtn || !buyForm) return;

    let shippingZones = [];
    let playCountryCodes = [];
    const EU_SHIPPING_CODES = new Set([
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
        "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"
    ]);

    function getShippingZoneFromCountryCode(code) {
        if (!code) return "";
        const c = String(code).toUpperCase();
        if (c === "BG") return "BG";
        if (EU_SHIPPING_CODES.has(c)) return "EU";
        if (c === "GB" || c === "CH" || c === "NO") return "UK_CH_NO";
        if (c === "US" || c === "CA") return "US_CA";
        return "WORLD";
    }

    function populateDeliveryCountryOptions() {
        const sel = document.getElementById("buyDeliveryCountry");
        if (!sel || !playCountryCodes.length) return;
        const current = sel.value;
        while (sel.options.length > 1) {
            sel.remove(1);
        }
        const lang = document.documentElement.lang || "en";
        const loc = lang === "bg" ? "bg" : lang === "de" ? "de" : "en";
        let names;
        try {
            names = new Intl.DisplayNames([loc], { type: "region" });
        } catch (e) {
            names = new Intl.DisplayNames(["en"], { type: "region" });
        }
        const sorted = [...playCountryCodes].sort((a, b) => {
            const na = names.of(a) || a;
            const nb = names.of(b) || b;
            return na.localeCompare(nb, loc);
        });
        sorted.forEach((code) => {
            const opt = document.createElement("option");
            opt.value = code;
            opt.textContent = names.of(code) || code;
            sel.appendChild(opt);
        });
        if (current && playCountryCodes.includes(current)) {
            sel.value = current;
        }
    }

    function syncZoneFromDeliveryCountry() {
        if (!deliveryCountrySelect || !shippingZoneSelect) return;
        const code = deliveryCountrySelect.value ? deliveryCountrySelect.value.trim() : "";
        shippingZoneSelect.value = code ? getShippingZoneFromCountryCode(code) : "";
    }

    function buildCombinedDeliveryAddress() {
        const countryCode = (buyForm.querySelector('[name="deliveryCountry"]') && buyForm.querySelector('[name="deliveryCountry"]').value) || "";
        const city = (buyForm.querySelector('[name="deliveryCity"]') && buyForm.querySelector('[name="deliveryCity"]').value) || "";
        const postal = (buyForm.querySelector('[name="deliveryPostalCode"]') && buyForm.querySelector('[name="deliveryPostalCode"]').value) || "";
        const street = (buyForm.querySelector('[name="deliveryStreet"]') && buyForm.querySelector('[name="deliveryStreet"]').value) || "";
        const lang = document.documentElement.lang || "en";
        const loc = lang === "bg" ? "bg" : lang === "de" ? "de" : "en";
        let countryName = "";
        if (countryCode) {
            try {
                const dn = new Intl.DisplayNames([loc], { type: "region" });
                countryName = dn.of(countryCode) || countryCode;
            } catch (e) {
                countryName = countryCode;
            }
        }
        const parts = [];
        if (countryName) parts.push(countryName);
        if (String(city).trim()) parts.push(String(city).trim());
        if (String(postal).trim()) parts.push(String(postal).trim());
        if (String(street).trim()) parts.push(String(street).trim());
        return parts.join(" · ");
    }

    Promise.all([
        fetch("shipping.json").then((r) => r.json()),
        fetch("google-play-countries.json").then((r) => r.json())
    ])
        .then(([shipData, playData]) => {
            shippingZones = shipData.zones || [];
            playCountryCodes = playData.codes || [];
            populateDeliveryCountryOptions();
            syncZoneFromDeliveryCountry();
            updateDeliveryEstimate();
        })
        .catch(() => {});

    function hasExpress(zone) {
        return zone && typeof zone.expressPriceMax === "number";
    }

    function getShippingForZone(zoneId, method) {
        const zone = shippingZones.find((z) => z.id === zoneId);
        if (!zone) return null;
        const useExpress = method === "express" && hasExpress(zone);
        const priceMax = useExpress ? zone.expressPriceMax : zone.priceMax;
        const priceMin = useExpress ? (zone.expressPriceMin ?? zone.expressPriceMax) : zone.priceMin;
        const shipDaysMin = useExpress ? (zone.expressShippingDaysMin || 0) : (zone.shippingDaysMin || 0);
        const shipDaysMax = useExpress ? (zone.expressShippingDaysMax || 0) : (zone.shippingDaysMax || 0);
        const totalDaysMin = (zone.processingDaysMin || 0) + shipDaysMin;
        const totalDaysMax = (zone.processingDaysMax || 0) + shipDaysMax;
        return { zone: { ...zone, priceMin, priceMax, currency: zone.currency }, totalDaysMin, totalDaysMax };
    }

    function addWorkingDays(fromDate, workingDays) {
            const d = new Date(fromDate.getTime());
            let added = 0;
            while (added < workingDays) {
                d.setDate(d.getDate() + 1);
                const day = d.getDay();
                if (day !== 0 && day !== 6) added++;
            }
            return d;
        }

        function formatDeliveryDate(date, refYear) {
            const dd = String(date.getDate()).padStart(2, "0");
            const mm = String(date.getMonth() + 1).padStart(2, "0");
            const y = date.getFullYear();
            return y !== refYear ? dd + "." + mm + "." + y : dd + "." + mm;
        }

        function updateDeliveryEstimate() {
            if (!deliveryPriceDaysEl) return;
            const zoneId = shippingZoneSelect && shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
            const method = (shippingMethodSelect && shippingMethodSelect.value) || "standard";
            if (!zoneId) {
                deliveryPriceDaysEl.textContent = "";
                if (shippingMethodWrap) shippingMethodWrap.style.display = "none";
                updateSummary();
                updateOrderButtonState();
                return;
            }
            const zone = shippingZones.find((z) => z.id === zoneId);
            if (shippingMethodWrap) shippingMethodWrap.style.display = hasExpress(zone) ? "flex" : "none";
            const result = getShippingForZone(zoneId, method);
            if (!result) {
                deliveryPriceDaysEl.textContent = "";
                updateSummary();
                updateOrderButtonState();
                return;
            }
            const { zone: zoneResult, totalDaysMin, totalDaysMax } = result;
            const deliveryEur = pricingCfg.testMode
                ? pricingCfg.testDeliveryEur
                : zoneResult.currency === "BGN"
                  ? zoneResult.priceMax / BGN_TO_EUR
                  : zoneResult.priceMax;
            const priceStr = formatPriceCents(Math.round(deliveryEur * 100) / 100);
            const orderDate = new Date();
            const deliveryStart = addWorkingDays(orderDate, totalDaysMin);
            const deliveryEnd = addWorkingDays(orderDate, totalDaysMax);
            const refYear = orderDate.getFullYear();
            const dateRangeStr = totalDaysMin === totalDaysMax
                ? formatDeliveryDate(deliveryStart, refYear)
                : formatDeliveryDate(deliveryStart, refYear) + " – " + formatDeliveryDate(deliveryEnd, refYear);
            deliveryPriceDaysEl.textContent = priceStr + ", " + dateRangeStr + ".";
            updateSummary();
            updateOrderButtonState();
        }

    const BGN_TO_EUR = 1.95583;

    function getDeliveryAmountEur() {
        if (pricingCfg.testMode) return pricingCfg.testDeliveryEur;
        const zoneId = shippingZoneSelect && shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
        const method = (shippingMethodSelect && shippingMethodSelect.value) || "standard";
        const result = zoneId ? getShippingForZone(zoneId, method) : null;
        if (!result) return 0;
        const zone = result.zone;
        if (zone.currency === "EUR") return zone.priceMax;
        if (zone.currency === "BGN") return zone.priceMax / BGN_TO_EUR;
        return zone.priceMax;
    }

    function updateOrderButtonState() {
        if (!buySubmitBtn || !shippingZoneSelect) return;
        const zoneId = shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
        if ((cardPayModeActive || revolutPayModeActive) && zoneId) {
            buySubmitBtn.disabled = false;
            buySubmitBtn.setAttribute("aria-disabled", "false");
            return;
        }
        buySubmitBtn.disabled = !zoneId;
        buySubmitBtn.setAttribute("aria-disabled", zoneId ? "false" : "true");
    }

    if (deliveryCountrySelect) {
        deliveryCountrySelect.addEventListener("change", () => {
            syncZoneFromDeliveryCountry();
            if (shippingMethodSelect) shippingMethodSelect.value = "standard";
            updateDeliveryEstimate();
            scheduleOnlinePayRefresh();
        });
    }
    if (shippingMethodSelect) shippingMethodSelect.addEventListener("change", updateDeliveryEstimate);
    window.addEventListener("aura-lang-applied", function () {
        populateDeliveryCountryOptions();
        updateDeliveryEstimate();
        if (cardPayModeActive && buySubmitBtn) {
            buySubmitBtn.textContent =
                tBuy("buyPanel.payWithCardConfirm") ||
                tBuy("buyPanel.payWithCard") ||
                "Pay with card";
        } else {
            resetSubmitButtonLabel();
        }
    });

    const pricingCfg = window.AURA_PRICING || {
        testMode: false,
        unitPriceEur: 59,
        bundles: { 1: 59, 3: 159, 5: 249 },
        testDeliveryEur: 0.01,
    };
    const UNIT_PRICE_EUR = pricingCfg.unitPriceEur;
    const BUNDLES = pricingCfg.bundles;

    function formatPrice(amount) {
        const lang = document.documentElement.lang || "en";
        const locale = lang === "bg" ? "bg-BG" : lang === "de" ? "de-DE" : "en-US";
        try {
            return (
                new Intl.NumberFormat(locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                }).format(amount) + " €"
            );
        } catch (e) {
            return Number(amount).toFixed(2) + " €";
        }
    }

    function formatPriceCents(amount) {
        return formatPrice(amount);
    }

    function getTotalForQty(q) {
        if (BUNDLES[q]) return BUNDLES[q];
        return q * UNIT_PRICE_EUR;
    }

    function applyStaticPricingDisplay() {
        document.querySelectorAll(".pricing-card").forEach((card) => {
            const packBtn = card.querySelector("[data-pack]");
            const qty = packBtn ? parseInt(packBtn.getAttribute("data-pack"), 10) : 0;
            const priceEl = card.querySelector(".pricing-card-price");
            if (!priceEl || !qty) return;
            priceEl.textContent = formatPrice(getTotalForQty(qty)).replace(" €", "\u00a0€");
        });

        const buyPanelPrice = document.querySelector(".buy-panel-price");
        if (buyPanelPrice) {
            buyPanelPrice.textContent = formatPrice(UNIT_PRICE_EUR).replace(" €", "\u00a0€");
        }

        const schemaScript = document.querySelector('script[type="application/ld+json"]');
        if (schemaScript && pricingCfg.testMode) {
            try {
                const data = JSON.parse(schemaScript.textContent);
                if (data && data.offers) {
                    data.offers.price = UNIT_PRICE_EUR.toFixed(2);
                    schemaScript.textContent = JSON.stringify(data);
                }
            } catch (_) {}
        }

        if (pricingCfg.testMode && !document.getElementById("checkoutTestBanner")) {
            const banner = document.createElement("div");
            banner.id = "checkoutTestBanner";
            banner.style.cssText =
                "position:fixed;bottom:0;left:0;right:0;background:#f59e0b;color:#111;text-align:center;padding:8px 12px;font-size:14px;z-index:9999;";
            banner.textContent =
                "Тестови цени (0.01 €) – само за проверка на плащането с карта";
            document.body.appendChild(banner);
        }
    }

    applyStaticPricingDisplay();

    let cardPayModeActive = false;
    let revolutPayModeActive = false;
    let revolutConfigCache = undefined;
    let onlinePayMountTimer = null;
    let cardFieldInstance = null;
    let lastCardMountKey = "";
    const cardMount = document.getElementById("buyCardPayMount");
    const revolutMount = document.getElementById("buyRevolutPayMount");
    const payHintEl = document.getElementById("buyPayHint");
    const cardFieldHintEl = document.getElementById("buyCardFieldHint");
    const cardValidationHintEl = document.getElementById("buyCardValidationHint");
    const buyPayFooter = document.getElementById("buyPanelPayFooter");
    const cardholderField = document.getElementById("cardholderField");
    const cardholderInput = document.getElementById("buyCardholderName");

    function tBuy(key) {
        const lang = document.documentElement.lang || "en";
        return typeof getTranslation === "function" ? getTranslation(lang, key) : "";
    }

    function resetSubmitButtonLabel() {
        if (buySubmitBtn) buySubmitBtn.textContent = tBuy("buyPanel.submit") || "Order";
    }

    function teardownOnlinePay() {
        cardPayModeActive = false;
        revolutPayModeActive = false;
        lastCardMountKey = "";
        if (cardFieldInstance) {
            try {
                cardFieldInstance.destroy();
            } catch (_) {}
            cardFieldInstance = null;
        }
        if (cardMount) {
            cardMount.innerHTML = "";
            cardMount.hidden = true;
        }
        if (revolutMount) {
            revolutMount.innerHTML = "";
            revolutMount.hidden = true;
        }
        if (cardholderField) cardholderField.style.display = "none";
        if (cardFieldHintEl) cardFieldHintEl.hidden = true;
        if (cardValidationHintEl) cardValidationHintEl.hidden = true;
        if (buySubmitBtn) {
            buySubmitBtn.hidden = false;
            resetSubmitButtonLabel();
        }
        updateOrderButtonState();
    }

    function getCardMountKey() {
        const q = parseInt(qtyInput && qtyInput.value, 10) || 1;
        const shipMethod = (shippingMethodSelect && shippingMethodSelect.value) || "standard";
        return [
            getCheckoutZoneId(),
            q,
            shipMethod,
            Math.round(getBuyOrderTotalEur() * 100),
        ].join("|");
    }

    function tryScheduleCardMountWhenReady() {
        if (!paymentSelect || paymentSelect.value !== "card") return;
        scheduleOnlinePayRefresh();
    }

    async function fetchRevolutConfig() {
        const base = (typeof window !== "undefined" && window.INQUIRY_FUNCTIONS_BASE_URL)
            ? window.INQUIRY_FUNCTIONS_BASE_URL.trim().replace(/\/$/, "")
            : "";
        if (!base) return null;
        if (revolutConfigCache !== undefined) return revolutConfigCache;
        try {
            const res = await fetch(base + "/api/revolut-config");
            revolutConfigCache = await res.json().catch(() => ({}));
        } catch (e) {
            revolutConfigCache = {};
        }
        return revolutConfigCache;
    }

    function getCheckoutZoneId() {
        return shippingZoneSelect && shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
    }

    function getRevolutAddressMeta() {
        const countryCode = (deliveryCountrySelect && deliveryCountrySelect.value) || "";
        const city = (buyForm.querySelector('[name="deliveryCity"]') && buyForm.querySelector('[name="deliveryCity"]').value.trim()) || "";
        const postcode = (buyForm.querySelector('[name="deliveryPostalCode"]') && buyForm.querySelector('[name="deliveryPostalCode"]').value.trim()) || "";
        const street = (buyForm.querySelector('[name="deliveryStreet"]') && buyForm.querySelector('[name="deliveryStreet"]').value.trim()) || "";
        return {
            countryCode: countryCode,
            city: city,
            postcode: postcode,
            streetLine1: street,
        };
    }

    async function createRevolutOrderForCheckout() {
        const baseRaw = typeof window.INQUIRY_FUNCTIONS_BASE_URL === "string" ? window.INQUIRY_FUNCTIONS_BASE_URL : "";
        const base = baseRaw.trim().replace(/\/$/, "");
        if (!base) throw new Error("Backend URL missing");
        const q = parseInt(qtyInput.value, 10) || 1;
        const z = getCheckoutZoneId();
        const shipMethod = (shippingMethodSelect && shippingMethodSelect.value) || "standard";
        const amountMinor = Math.round(getBuyOrderTotalEur() * 100);
        const res = await fetch(base + "/api/revolut-order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                amountMinor: amountMinor,
                currency: "EUR",
                quantity: q,
                shippingZone: z,
                shippingMethod: shipMethod,
                description: "Aura HomeSystems — " + q + " sensor(s)",
            }),
        });
        const order = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(order.error || "Order failed");
        return order.revolutPublicOrderId;
    }

    async function loadRevolutCheckoutModule() {
        return import("https://unpkg.com/@revolut/checkout@1.1.25/esm");
    }

    function getBuyOrderTotalEur() {
        if (!qtyInput) return 0;
        let q = parseInt(qtyInput.value, 10);
        if (!Number.isFinite(q) || q < 1) q = 1;
        if (q > 99) q = 99;
        const total = getTotalForQty(q);
        const deliveryEur = getDeliveryAmountEur ? getDeliveryAmountEur() : 0;
        return Math.round((total + deliveryEur) * 100) / 100;
    }

    async function submitBuyPanelOrder(opts) {
        const fromRevolutPay = opts && opts.fromRevolutPay;
        const fromCardPay = opts && opts.fromCardPay;
        const zoneId = shippingZoneSelect && shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
        if (!zoneId) {
            const lang = document.documentElement.lang || "en";
            const msg = { bg: "Изберете държава / регион за доставка.", en: "Please select country / region for delivery.", de: "Bitte wählen Sie Land / Region für die Lieferung." };
            if (buyStatus) { buyStatus.textContent = msg[lang] || msg.en; buyStatus.className = "form-status form-status-error"; }
            return false;
        }
        const functionsBase = (typeof window !== "undefined" && window.INQUIRY_FUNCTIONS_BASE_URL) ? window.INQUIRY_FUNCTIONS_BASE_URL.trim() : "";
        const useVerifyFlow = !!functionsBase;
        if (!useVerifyFlow && FORMSPREE_FORM_ID === "YOUR_FORMSPREE_FORM_ID") {
            if (buyStatus) {
                buyStatus.textContent = "Настройте FORMSPREE_FORM_ID в app.js.";
                buyStatus.className = "form-status form-status-error";
            }
            return false;
        }

        const origLabel = buySubmitBtn ? buySubmitBtn.textContent : "";
        if (buySubmitBtn && !revolutPayModeActive && !cardPayModeActive) { buySubmitBtn.disabled = true; buySubmitBtn.textContent = "..."; }
        if (buyStatus && !fromRevolutPay && !fromCardPay) {
            buyStatus.textContent = "";
            buyStatus.className = "form-status";
        }

        const lang = document.documentElement.lang || "en";
        const msgError = { bg: "Неуспешно. Опитайте отново.", en: "Failed. Try again.", de: "Fehlgeschlagen. Bitte erneut versuchen." };
        const msgSuccessTitle = { bg: "Поръчката е изпратена!", en: "Order submitted!", de: "Bestellung gesendet!" };

        const quantity = (qtyInput && qtyInput.value) || "1";
        const paymentMethod = (buyForm.querySelector('select[name="paymentMethod"]') && buyForm.querySelector('select[name="paymentMethod"]').value) || "";
        let revolutId = (buyForm.querySelector('input[name="revolutId"]') && buyForm.querySelector('input[name="revolutId"]').value.trim()) || "";
        if (fromRevolutPay) revolutId = "Revolut Pay";
        if (fromCardPay) revolutId = "Card payment";
        const deliveryAddress = buildCombinedDeliveryAddress();
        const addrHidden = document.getElementById("buyDeliveryAddressCombined");
        if (addrHidden) addrHidden.value = deliveryAddress;
        const phone = (buyForm.querySelector('input[name="phone"]') && buyForm.querySelector('input[name="phone"]').value) || "";
        const email = (buyForm.querySelector('input[name="_replyto"]') && buyForm.querySelector('input[name="_replyto"]').value.trim()) || "";

        let payMsg = `Direct order: ${quantity} pcs, Payment: ${paymentMethod}, Address: ${deliveryAddress}`;
        if (fromRevolutPay) payMsg += " [Revolut Pay: payment completed]";
        if (fromCardPay) payMsg += " [Card payment: completed]";

        try {
            if (useVerifyFlow) {
                const baseUrl = window.location.origin + (window.location.pathname || "").replace(/[^/]+$/, "").replace(/\/$/, "");
                const res = await fetch(functionsBase.replace(/\/$/, "") + "/submitInquiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email,
                        subject: "Direct order",
                        message: payMsg,
                        phone,
                        orderType: "direct",
                        quantity,
                        paymentMethod,
                        revolutId,
                        deliveryAddress,
                        baseUrl
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    buyForm.reset();
                    if (qtyInput) qtyInput.value = 1;
                    teardownOnlinePay();
                    closePanel();
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.en);
                    return true;
                } else {
                    if (buyStatus) {
                        buyStatus.textContent = data.error || msgError[lang] || msgError.en;
                        buyStatus.className = "form-status form-status-error";
                    }
                    return false;
                }
            } else {
                const formData = new FormData(buyForm);
                formData.set("_subject", "Direct order – " + quantity + " pcs");
                if (fromRevolutPay) formData.set("revolutId", "Revolut Pay");
                const res = await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
                    method: "POST",
                    body: formData,
                    headers: { Accept: "application/json" }
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && (data.ok === true || res.status === 200)) {
                    buyForm.reset();
                    if (qtyInput) qtyInput.value = 1;
                    teardownOnlinePay();
                    closePanel();
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.en);
                    return true;
                } else {
                    if (buyStatus) {
                        buyStatus.textContent = msgError[lang] || msgError.en;
                        buyStatus.className = "form-status form-status-error";
                    }
                    return false;
                }
            }
        } catch (err) {
            if (buyStatus) {
                buyStatus.textContent = msgError[lang] || msgError.en;
                buyStatus.className = "form-status form-status-error";
            }
            return false;
        } finally {
            if (buySubmitBtn && !revolutPayModeActive && !cardPayModeActive) { buySubmitBtn.disabled = false; buySubmitBtn.textContent = origLabel; }
        }
    }

    function scheduleOnlinePayRefresh() {
        if (onlinePayMountTimer) clearTimeout(onlinePayMountTimer);
        onlinePayMountTimer = setTimeout(function () {
            if (!paymentSelect) return;
            if (paymentSelect.value === "card") doRefreshCardFieldMount();
            else if (paymentSelect.value === "revolut") doRefreshRevolutPayMount();
        }, 150);
    }

    async function doRefreshCardFieldMount() {
        if (!paymentSelect || paymentSelect.value !== "card" || !cardMount) return;

        const zoneId = getCheckoutZoneId();
        if (!zoneId) return;

        if (cardholderField) cardholderField.style.display = "flex";
        if (cardholderInput) cardholderInput.required = true;

        const cfg = await fetchRevolutConfig();
        if (!cfg || !cfg.publicKey) {
            teardownOnlinePay();
            if (buyStatus) {
                buyStatus.textContent = tBuy("buyPanel.cardPayUnavailable") || "";
                buyStatus.className = "form-status form-status-error";
            }
            return;
        }

        if (!buyForm.checkValidity()) {
            if (cardFieldInstance) {
                try {
                    cardFieldInstance.destroy();
                } catch (_) {}
                cardFieldInstance = null;
            }
            cardPayModeActive = false;
            if (cardMount) {
                cardMount.innerHTML = "";
                cardMount.hidden = true;
            }
            if (cardFieldHintEl) cardFieldHintEl.hidden = true;
            if (cardValidationHintEl) cardValidationHintEl.hidden = true;
            if (buyStatus) {
                buyStatus.textContent = tBuy("buyPanel.payFillFormFirst") || "";
                buyStatus.className = "form-status";
            }
            resetSubmitButtonLabel();
            updateOrderButtonState();
            return;
        }

        const mountKey = getCardMountKey();
        if (cardPayModeActive && cardFieldInstance && mountKey === lastCardMountKey) {
            return;
        }

        if (cardFieldInstance) {
            try {
                cardFieldInstance.destroy();
            } catch (_) {}
            cardFieldInstance = null;
        }
        cardMount.innerHTML = "";
        cardPayModeActive = false;

        if (buyStatus) {
            buyStatus.textContent = "";
            buyStatus.className = "form-status";
        }

        try {
            const orderToken = await createRevolutOrderForCheckout();
            const mod = await loadRevolutCheckoutModule();
            const RevolutCheckout = mod.default;
            const checkoutMode = cfg.mode === "sandbox" ? "sandbox" : "prod";
            const checkout = await RevolutCheckout(orderToken, checkoutMode);
            cardFieldInstance = checkout.createCardField({
                target: cardMount,
                theme: "light",
                locale: document.documentElement.lang || "auto",
                onSuccess: function () {
                    submitBuyPanelOrder({ fromCardPay: true });
                },
                onError: function (err) {
                    if (buySubmitBtn) buySubmitBtn.disabled = false;
                    if (buyStatus) {
                        buyStatus.textContent = (err && err.message) || tBuy("buyPanel.cardPayInitError") || "";
                        buyStatus.className = "form-status form-status-error";
                    }
                },
                onValidation: function (errors) {
                    const invalid = Array.isArray(errors) && errors.length > 0;
                    if (cardValidationHintEl) {
                        cardValidationHintEl.hidden = !invalid;
                        if (invalid) {
                            cardValidationHintEl.textContent =
                                tBuy("buyPanel.cardValidationHint") ||
                                cardValidationHintEl.textContent;
                        }
                    }
                    if (!buySubmitBtn) return;
                    buySubmitBtn.disabled = false;
                    buySubmitBtn.setAttribute("aria-disabled", "false");
                },
            });
            cardMount.hidden = false;
            if (cardFieldHintEl) {
                cardFieldHintEl.hidden = false;
                cardFieldHintEl.textContent = tBuy("buyPanel.cardFieldHint") || cardFieldHintEl.textContent;
            }
            cardPayModeActive = true;
            lastCardMountKey = mountKey;
            if (buySubmitBtn) {
                buySubmitBtn.hidden = false;
                buySubmitBtn.disabled = false;
                buySubmitBtn.setAttribute("aria-disabled", "false");
                buySubmitBtn.textContent =
                    tBuy("buyPanel.payWithCardConfirm") ||
                    tBuy("buyPanel.payWithCard") ||
                    "Pay with card";
            }
            if (buyPayFooter) {
                requestAnimationFrame(function () {
                    buyPayFooter.scrollIntoView({ behavior: "smooth", block: "nearest" });
                });
            }
        } catch (err) {
            cardPayModeActive = false;
            lastCardMountKey = "";
            if (cardMount) cardMount.hidden = true;
            if (cardFieldHintEl) cardFieldHintEl.hidden = true;
            if (buyStatus) {
                buyStatus.textContent = (err && err.message) || tBuy("buyPanel.cardPayInitError") || "";
                buyStatus.className = "form-status form-status-error";
            }
            resetSubmitButtonLabel();
            updateOrderButtonState();
        }
    }

    async function doRefreshRevolutPayMount() {
        teardownOnlinePay();
        if (!paymentSelect || paymentSelect.value !== "revolut" || !revolutMount) return;

        const zoneId = getCheckoutZoneId();
        if (!zoneId) {
            if (revolutField) revolutField.style.display = "none";
            return;
        }

        const cfg = await fetchRevolutConfig();
        if (!cfg || !cfg.publicKey) {
            if (revolutField) revolutField.style.display = "flex";
            if (buyStatus) {
                buyStatus.textContent = tBuy("buyPanel.revolutPayUnavailable") || "";
                buyStatus.className = "form-status form-status-error";
            }
            return;
        }

        if (buyStatus) {
            buyStatus.textContent = "";
            buyStatus.className = "form-status";
        }
        if (revolutField) revolutField.style.display = "none";
        if (buySubmitBtn) buySubmitBtn.hidden = true;
        revolutMount.hidden = false;
        revolutPayModeActive = true;

        try {
            const mod = await loadRevolutCheckoutModule();
            const RevolutCheckout = mod.default;
            const { revolutPay } = await RevolutCheckout.payments({
                locale: document.documentElement.lang || "en",
                mode: cfg.mode === "sandbox" ? "sandbox" : "prod",
                publicToken: cfg.publicKey,
            });

            const returnUrl = function (param) {
                const u = new URL(window.location.href);
                u.search = "";
                u.hash = "";
                u.searchParams.set("payment", param);
                return u.toString();
            };

            const paymentOptions = {
                currency: "EUR",
                totalAmount: Math.round(getBuyOrderTotalEur() * 100),
                mobileRedirectUrls: {
                    success: returnUrl("revolut_success"),
                    failure: returnUrl("revolut_failure"),
                    cancel: returnUrl("revolut_cancel"),
                },
                createOrder: async function () {
                    if (!buyForm.checkValidity()) {
                        buyForm.reportValidity();
                        throw new Error("validation");
                    }
                    const publicId = await createRevolutOrderForCheckout();
                    return { publicId: publicId };
                },
            };

            revolutPay.mount(revolutMount, paymentOptions);
            revolutPay.on("payment", function (event) {
                if (event.type === "success") {
                    submitBuyPanelOrder({ fromRevolutPay: true });
                }
            });
        } catch (err) {
            revolutPayModeActive = false;
            if (buySubmitBtn) buySubmitBtn.hidden = false;
            if (revolutMount) revolutMount.hidden = true;
            if (revolutField) revolutField.style.display = "flex";
            if (buyStatus) {
                buyStatus.textContent = tBuy("buyPanel.revolutPayInitError") || "";
                buyStatus.className = "form-status form-status-error";
            }
        }
    }

    function updateSummary() {
        if (!qtyInput) return;
        let q = parseInt(qtyInput.value, 10);
        if (!Number.isFinite(q) || q < 1) q = 1;
        if (q > 99) q = 99;
        qtyInput.value = q;
        const total = getTotalForQty(q);
        const formatted = formatPrice(total);
        const summaryUnitPrice = document.getElementById("buySummaryUnitPrice");
        const summaryPriceLabel = document.getElementById("buySummaryPriceLabel");
        const lang = document.documentElement.lang || "en";
        const t = typeof getTranslation === "function" ? (key) => getTranslation(lang, key) : () => "";
        if (summaryQty) summaryQty.textContent = String(q);
        if (summaryPriceLabel) {
            if (q === 1) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelUnit") || "Price for 1 sensor";
            else if (q === 3) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelStandard") || "Standard bundle";
            else if (q === 5) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelAdvanced") || "Advanced bundle";
            else summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelMulti") || "Price";
        }
        if (summaryUnitPrice) {
            const br = t("buyPanel.summaryBr") || "pcs";
            if (q === 3) summaryUnitPrice.textContent = formatted;
            else if (q === 5) summaryUnitPrice.textContent = formatted;
            else summaryUnitPrice.textContent = formatted + " (" + q + " " + br + ")";
        }
        if (summarySubtotal) summarySubtotal.textContent = formatted;
        const deliveryEur = getDeliveryAmountEur ? getDeliveryAmountEur() : 0;
        const totalWithDelivery = Math.round((total + deliveryEur) * 100) / 100;
        if (summaryTotal) summaryTotal.textContent = formatPriceCents(totalWithDelivery);
        if (paymentSelect && (paymentSelect.value === "revolut" || paymentSelect.value === "card")) {
            scheduleOnlinePayRefresh();
        }
    }

    function updatePaymentFields() {
        if (!paymentSelect) return;
        const method = paymentSelect.value;
        if (revolutField) revolutField.style.display = "none";
        if (payHintEl) {
            if (method === "card") {
                payHintEl.hidden = false;
                payHintEl.textContent = tBuy("buyPanel.payCardHint") || "";
            } else if (method === "revolut") {
                payHintEl.hidden = false;
                payHintEl.textContent = tBuy("buyPanel.payRevolutHint") || "";
            } else {
                payHintEl.hidden = true;
                payHintEl.textContent = "";
            }
        }
        if (method !== "card" && method !== "revolut") {
            if (cardholderInput) cardholderInput.required = false;
            teardownOnlinePay();
            return;
        }
        scheduleOnlinePayRefresh();
    }

    function openPanel() {
        revolutConfigCache = undefined;
        overlay.classList.add("visible");
        panel.classList.add("visible");
        overlay.setAttribute("aria-hidden", "false");
        panel.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        updateSummary();
        syncZoneFromDeliveryCountry();
        updateDeliveryEstimate();
        updatePaymentFields();
    }
    function closePanel() {
        teardownOnlinePay();
        overlay.classList.remove("visible");
        panel.classList.remove("visible");
        overlay.setAttribute("aria-hidden", "true");
        panel.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }

    openBtn.addEventListener("click", openPanel);
    if (closeBtn) closeBtn.addEventListener("click", closePanel);
    overlay.addEventListener("click", closePanel);

    document.querySelectorAll(".pricing-card-btn[data-pack]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const pack = parseInt(btn.getAttribute("data-pack"), 10);
            if (qtyInput && Number.isFinite(pack) && pack >= 1) {
                qtyInput.value = Math.min(99, pack);
                openPanel();
            }
        });
    });

    if (qtyMinus && qtyInput) {
        qtyMinus.addEventListener("click", () => {
            const v = Math.max(1, parseInt(qtyInput.value, 10) - 1);
            qtyInput.value = v;
            updateSummary();
        });
    }
    if (qtyPlus && qtyInput) {
        qtyPlus.addEventListener("click", () => {
            const v = Math.min(99, parseInt(qtyInput.value, 10) + 1);
            qtyInput.value = v;
            updateSummary();
        });
    }

    if (paymentSelect) {
        paymentSelect.addEventListener("change", updatePaymentFields);
    }
    [
        cardholderInput,
        buyForm.querySelector('input[name="_replyto"]'),
        buyForm.querySelector('input[name="deliveryCity"]'),
        buyForm.querySelector('input[name="deliveryStreet"]'),
        buyForm.querySelector('input[name="deliveryPostalCode"]'),
        deliveryCountrySelect,
    ].forEach(function (el) {
        if (!el) return;
        el.addEventListener("blur", tryScheduleCardMountWhenReady);
    });

    buyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const paymentMethod = (buyForm.querySelector('select[name="paymentMethod"]') && buyForm.querySelector('select[name="paymentMethod"]').value) || "";
        if (paymentMethod === "revolut" && revolutPayModeActive) {
            return;
        }
        if (paymentMethod === "card" && cardPayModeActive && cardFieldInstance) {
            if (!buyForm.checkValidity()) {
                buyForm.reportValidity();
                return;
            }
            const email = (buyForm.querySelector('input[name="_replyto"]') && buyForm.querySelector('input[name="_replyto"]').value.trim()) || "";
            const name = (cardholderInput && cardholderInput.value.trim()) || "";
            if (!name) {
                if (buyStatus) {
                    buyStatus.textContent = tBuy("buyPanel.cardholderName") || "Cardholder name required";
                    buyStatus.className = "form-status form-status-error";
                }
                if (cardholderInput) cardholderInput.focus();
                return;
            }
            const address = getRevolutAddressMeta();
            if (buySubmitBtn) buySubmitBtn.disabled = true;
            cardFieldInstance.submit({
                name: name,
                email: email,
                billingAddress: address,
                shippingAddress: address,
            });
            return;
        }
        await submitBuyPanelOrder({});
    });
}

function initFaqAccordion() {
    const sectionTrigger = document.getElementById("faqSectionTrigger");
    const sectionWrap = document.getElementById("faq-list-wrap");
    const sectionParent = document.getElementById("faqSection");
    if (sectionTrigger && sectionWrap && sectionParent) {
        sectionTrigger.addEventListener("click", () => {
            const isOpen = sectionWrap.classList.contains("is-open");
            sectionWrap.classList.toggle("is-open", !isOpen);
            sectionParent.classList.toggle("is-open", !isOpen);
            sectionTrigger.setAttribute("aria-expanded", !isOpen ? "true" : "false");
        });
    }

    const list = document.querySelector(".faq-accordion");
    if (!list) return;
    const triggers = list.querySelectorAll(".faq-trigger");
    const items = list.querySelectorAll(".faq-item");
    triggers.forEach((btn, i) => {
        btn.addEventListener("click", () => {
            const item = items[i];
            const isOpen = item.classList.contains("is-open");
            items.forEach((el) => {
                el.classList.remove("is-open");
                const t = el.querySelector(".faq-trigger");
                if (t) t.setAttribute("aria-expanded", "false");
            });
            if (!isOpen) {
                item.classList.add("is-open");
                const t = item.querySelector(".faq-trigger");
                if (t) t.setAttribute("aria-expanded", "true");
            }
        });
    });
}

function initHeroSceneRotation() {
    const rowWindow = document.getElementById("heroStatusRowWindow");
    const rowDoor = document.getElementById("heroStatusRowDoor");
    const valueWindow = document.getElementById("heroStatusValueWindow");
    const valueDoor = document.getElementById("heroStatusValueDoor");
    const pushTitle = document.getElementById("heroPushTitle");
    if (!rowWindow || !rowDoor || !valueWindow || !valueDoor || !pushTitle) return;

    const states = [
        { windowOpen: true, doorOpen: false, notifKey: "scene.notifOpen" },
        { windowOpen: false, doorOpen: false, notifKey: "scene.notifAllClosed" },
        { windowOpen: false, doorOpen: true, notifKey: "scene.notifDoorOpen" },
        { windowOpen: true, doorOpen: true, notifKey: "scene.notifOpen" }
    ];
    let index = 0;

    function applyState() {
        const lang = document.documentElement.lang || "en";
        const t = typeof getTranslation === "function" ? (k) => getTranslation(lang, k) : () => "";
        const s = states[index];
        rowWindow.classList.toggle("status-open", s.windowOpen);
        rowWindow.classList.toggle("status-closed", !s.windowOpen);
        rowDoor.classList.toggle("status-open", s.doorOpen);
        rowDoor.classList.toggle("status-closed", !s.doorOpen);
        valueWindow.textContent = t(s.windowOpen ? "scene.statusOpenM" : "scene.statusClosedM");
        valueDoor.textContent = t(s.doorOpen ? "scene.statusOpenF" : "scene.statusClosedF");
        pushTitle.textContent = t(s.notifKey);
        index = (index + 1) % states.length;
    }

    setInterval(applyState, 3500);
    window.addEventListener("aura-lang-applied", applyState);
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof history !== "undefined" && history.scrollRestoration) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    initI18n();
    initHeroSceneRotation();
    initMobileMenu();
    initStatsCounters();
    initSmoothScroll();
    initFooterYear();
    initContactForm();
    initBuyPanel();
    initFaqAccordion();
});

function initMobileMenu() {
    const header = document.querySelector(".site-header");
    const toggle = document.getElementById("menuToggle");
    const nav = document.getElementById("mainNav");
    const backdrop = document.getElementById("menuBackdrop");
    if (!header || !toggle || !nav) return;

    toggle.addEventListener("click", () => {
        const isOpen = header.classList.toggle("menu-open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    if (backdrop) {
        backdrop.addEventListener("click", () => {
            header.classList.remove("menu-open");
            toggle.setAttribute("aria-expanded", "false");
        });
    }

    nav.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            header.classList.remove("menu-open");
            toggle.setAttribute("aria-expanded", "false");
        });
    });

    const more = nav.querySelector(".nav-more");
    const moreTrigger = more ? more.querySelector(".nav-more-trigger") : null;
    if (more && moreTrigger) {
        moreTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = more.classList.toggle("open");
            moreTrigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });
        document.addEventListener("click", (e) => {
            if (!more.classList.contains("open")) return;
            if (e.target.closest(".nav-more")) return;
            more.classList.remove("open");
            moreTrigger.setAttribute("aria-expanded", "false");
        });
    }

    document.addEventListener("click", (e) => {
        if (e.target.closest(".site-header")) return;
        header.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
    });
}

