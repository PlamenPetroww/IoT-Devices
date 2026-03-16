function applyLanguage(lang) {
    if (!translations[lang]) lang = "bg";
    document.documentElement.lang = lang === "de" ? "de" : lang === "en" ? "en" : "bg";

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
    if (triggerCode) triggerCode.textContent = codes[lang] || codes.bg;
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
    let lang = "bg";
    try { lang = localStorage.getItem("aura-lang") || "bg"; } catch (_) {}
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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
        const lang = document.documentElement.lang || "bg";
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
                    showSuccessNotification(msgVerifyTitle[lang] || msgVerifyTitle.bg, msgVerifyText[lang] || msgVerifyText.bg);
                } else {
                    statusEl.textContent = data.error || msgError[lang] || msgError.bg;
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
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.bg);
                } else {
                    statusEl.textContent = msgError[lang] || msgError.bg;
                    statusEl.className = "form-status form-status-error";
                }
            }
        } catch (err) {
            statusEl.textContent = msgError[lang] || msgError.bg;
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
    if (!overlay || !panel || !openBtn || !buyForm) return;

    let shippingZones = [];
    fetch("shipping.json")
        .then((r) => r.json())
        .then((data) => { shippingZones = data.zones || []; updateDeliveryEstimate(); })
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
            const deliveryEur = zoneResult.currency === "BGN" ? zoneResult.priceMax / BGN_TO_EUR : zoneResult.priceMax;
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
        buySubmitBtn.disabled = !zoneId;
        buySubmitBtn.setAttribute("aria-disabled", zoneId ? "false" : "true");
    }

    if (shippingZoneSelect) {
        shippingZoneSelect.addEventListener("change", () => {
            if (shippingMethodSelect) shippingMethodSelect.value = "standard";
            updateDeliveryEstimate();
        });
    }
    if (shippingMethodSelect) shippingMethodSelect.addEventListener("change", updateDeliveryEstimate);
    window.addEventListener("aura-lang-applied", function () { updateDeliveryEstimate(); });

    const UNIT_PRICE_EUR = 69;
    const BUNDLES = { 1: 69, 3: 189, 5: 299 };

    function formatPrice(amount) {
        const lang = document.documentElement.lang || "bg";
        const locale = lang === "bg" ? "bg-BG" : lang === "de" ? "de-DE" : "en-US";
        try {
            return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount) + " €";
        } catch (e) {
            return amount + " €";
        }
    }

    function formatPriceCents(amount) {
        const lang = document.documentElement.lang || "bg";
        const locale = lang === "bg" ? "bg-BG" : lang === "de" ? "de-DE" : "en-US";
        try {
            return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount) + " €";
        } catch (e) {
            return Number(amount).toFixed(2) + " €";
        }
    }

    function getTotalForQty(q) {
        if (BUNDLES[q]) return BUNDLES[q];
        return q * UNIT_PRICE_EUR;
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
        const lang = document.documentElement.lang || "bg";
        const t = typeof getTranslation === "function" ? (key) => getTranslation(lang, key) : () => "";
        if (summaryQty) summaryQty.textContent = String(q);
        if (summaryPriceLabel) {
            if (q === 1) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelUnit") || "Цена за 1 сензор";
            else if (q === 3) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelStandard") || "Standard пакет";
            else if (q === 5) summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelAdvanced") || "Advanced пакет";
            else summaryPriceLabel.textContent = t("buyPanel.summaryPriceLabelMulti") || "Цена";
        }
        if (summaryUnitPrice) {
            const br = t("buyPanel.summaryBr") || "бр.";
            if (q === 3) summaryUnitPrice.textContent = formatted;
            else if (q === 5) summaryUnitPrice.textContent = formatted;
            else summaryUnitPrice.textContent = formatted + " (" + q + " " + br + ")";
        }
        if (summarySubtotal) summarySubtotal.textContent = formatted;
        const deliveryEur = getDeliveryAmountEur ? getDeliveryAmountEur() : 0;
        const totalWithDelivery = Math.round((total + deliveryEur) * 100) / 100;
        if (summaryTotal) summaryTotal.textContent = formatPriceCents(totalWithDelivery);
    }

    function updatePaymentFields() {
        if (!revolutField || !paymentSelect) return;
        const method = paymentSelect.value;
        revolutField.style.display = method === "revolut" ? "flex" : "none";
    }

    function openPanel() {
        overlay.classList.add("visible");
        panel.classList.add("visible");
        overlay.setAttribute("aria-hidden", "false");
        panel.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
        updateSummary();
        updateDeliveryEstimate();
        updatePaymentFields();
    }
    function closePanel() {
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

    buyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const zoneId = shippingZoneSelect && shippingZoneSelect.value ? shippingZoneSelect.value.trim() : "";
        if (!zoneId) {
            const lang = document.documentElement.lang || "bg";
            const msg = { bg: "Изберете държава / регион за доставка.", en: "Please select country / region for delivery.", de: "Bitte wählen Sie Land / Region für die Lieferung." };
            if (buyStatus) { buyStatus.textContent = msg[lang] || msg.bg; buyStatus.className = "form-status form-status-error"; }
            return;
        }
        const functionsBase = (typeof window !== "undefined" && window.INQUIRY_FUNCTIONS_BASE_URL) ? window.INQUIRY_FUNCTIONS_BASE_URL.trim() : "";
        const useVerifyFlow = !!functionsBase;
        if (!useVerifyFlow && FORMSPREE_FORM_ID === "YOUR_FORMSPREE_FORM_ID") {
            buyStatus.textContent = "Настройте FORMSPREE_FORM_ID в app.js.";
            buyStatus.className = "form-status form-status-error";
            return;
        }

        const origLabel = buySubmitBtn ? buySubmitBtn.textContent : "";
        if (buySubmitBtn) { buySubmitBtn.disabled = true; buySubmitBtn.textContent = "..."; }
        buyStatus.textContent = "";
        buyStatus.className = "form-status";

        const lang = document.documentElement.lang || "bg";
        const msgError = { bg: "Неуспешно. Опитайте отново.", en: "Failed. Try again.", de: "Fehlgeschlagen. Bitte erneut versuchen." };
        const msgSuccessTitle = { bg: "Поръчката е изпратена!", en: "Order submitted!", de: "Bestellung gesendet!" };

        const quantity = (qtyInput && qtyInput.value) || "1";
        const paymentMethod = (buyForm.querySelector('select[name="paymentMethod"]') && buyForm.querySelector('select[name="paymentMethod"]').value) || "";
        const revolutId = (buyForm.querySelector('input[name="revolutId"]') && buyForm.querySelector('input[name="revolutId"]').value.trim()) || "";
        const deliveryAddress = (buyForm.querySelector('input[name="deliveryAddress"]') && buyForm.querySelector('input[name="deliveryAddress"]').value.trim()) || "";
        const phone = (buyForm.querySelector('input[name="phone"]') && buyForm.querySelector('input[name="phone"]').value) || "";
        const email = (buyForm.querySelector('input[name="_replyto"]') && buyForm.querySelector('input[name="_replyto"]').value.trim()) || "";

        try {
            if (useVerifyFlow) {
                const baseUrl = window.location.origin + (window.location.pathname || "").replace(/[^/]+$/, "").replace(/\/$/, "");
                const res = await fetch(functionsBase.replace(/\/$/, "") + "/submitInquiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email,
                        subject: "Direct order",
                        message: `Direct order: ${quantity} pcs, Payment: ${paymentMethod}, Address: ${deliveryAddress}`,
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
                    closePanel();
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.bg);
                } else {
                    buyStatus.textContent = data.error || msgError[lang] || msgError.bg;
                    buyStatus.className = "form-status form-status-error";
                }
            } else {
                const formData = new FormData(buyForm);
                formData.set("_subject", "Direct order – " + quantity + " pcs");
                const res = await fetch(`https://formspree.io/f/${FORMSPREE_FORM_ID}`, {
                    method: "POST",
                    body: formData,
                    headers: { Accept: "application/json" }
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && (data.ok === true || res.status === 200)) {
                    buyForm.reset();
                    if (qtyInput) qtyInput.value = 1;
                    closePanel();
                    showSuccessNotification(msgSuccessTitle[lang] || msgSuccessTitle.bg);
                } else {
                    buyStatus.textContent = msgError[lang] || msgError.bg;
                    buyStatus.className = "form-status form-status-error";
                }
            }
        } catch (err) {
            buyStatus.textContent = msgError[lang] || msgError.bg;
            buyStatus.className = "form-status form-status-error";
        }
        if (buySubmitBtn) { buySubmitBtn.disabled = false; buySubmitBtn.textContent = origLabel; }
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
        const lang = document.documentElement.lang || "bg";
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

