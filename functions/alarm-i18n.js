const ALARM_I18N = {
    bg: {
        title: "Aura HomeSystems",
        open: (name) => `${name} — отворено`,
        closed: (name) => `${name} — затворено`,
        emailSubject: (name) => `Аларма — ${name}`,
        emailIntro:
            "Push \u0438\u0437\u0432\u0435\u0441\u0442\u0438\u0435\u0442\u043e \u043d\u0435 \u0441\u0442\u0438\u0433\u043d\u0430 \u0434\u043e \u0442\u0435\u043b\u0435\u0444\u043e\u043d\u0430 (\u043d\u044f\u043c\u0430 \u0442\u043e\u043a\u0435\u043d \u0438\u043b\u0438 \u0434\u043e\u0441\u0442\u0430\u0432\u043a\u0430\u0442\u0430 \u0435 \u043d\u0435\u0443\u0441\u043f\u0435\u0448\u043d\u0430).",
    },
    en: {
        title: "Aura HomeSystems",
        open: (name) => `${name} was opened.`,
        closed: (name) => `${name} was closed.`,
        emailSubject: (name) => `Alarm alert — ${name}`,
        emailIntro:
            "Push notification could not be delivered to your phone (no app token or delivery failed).",
    },
    de: {
        title: "Aura HomeSystems",
        open: (name) => `${name} wurde geöffnet.`,
        closed: (name) => `${name} wurde geschlossen.`,
        emailSubject: (name) => `Alarm — ${name}`,
        emailIntro:
            "Push-Benachrichtigung konnte nicht auf Ihr Telefon zugestellt werden (kein App-Token oder Zustellung fehlgeschlagen).",
    },
};

export function normalizeAlarmLang(lang) {
    const code = String(lang || "en")
        .trim()
        .toLowerCase()
        .slice(0, 2);
    return ALARM_I18N[code] ? code : "en";
}

export function getAlarmTexts(lang, deviceName, isOpen) {
    const pack = ALARM_I18N[normalizeAlarmLang(lang)];
    const name = String(deviceName || "Sensor").trim() || "Sensor";
    return {
        title: pack.title,
        body: isOpen ? pack.open(name) : pack.closed(name),
        emailSubject: pack.emailSubject(name),
        emailIntro: pack.emailIntro,
    };
}
