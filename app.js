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
    try { localStorage.setItem("aura-lang", lang); } catch (_) {}
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
                const baseUrl = window.location.origin + (window.location.pathname || "").replace(/[^/]+$/, "").replace(/\/$/, "");
                const res = await fetch(functionsBase.replace(/\/$/, "") + "/submitInquiry", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, subject, message, phone, baseUrl })
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

document.addEventListener("DOMContentLoaded", () => {
    initI18n();
    initStatsCounters();
    initSmoothScroll();
    initFooterYear();
    initContactForm();
});

