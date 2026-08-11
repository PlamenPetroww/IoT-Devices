const ALARM_I18N = {
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
    if (code === "bg") return "en";
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
