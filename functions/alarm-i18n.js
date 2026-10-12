const ALARM_I18N = {
    en: {
        title: "Aura HomeSystems",
        open: (name) => `${name} was opened.`,
        closed: (name) => `${name} was closed.`,
        sirenTitle: "Aura siren activated",
        siren: "The local siren has been activated.",
        emailSubject: (name) => `Alarm alert — ${name}`,
        emailIntro:
            "Your phone did not confirm that the alarm was shown. The siren still runs locally.",
    },
    de: {
        title: "Aura HomeSystems",
        open: (name) => `${name} wurde geöffnet.`,
        closed: (name) => `${name} wurde geschlossen.`,
        sirenTitle: "Aura-Sirene ausgelöst",
        siren: "Die lokale Sirene wurde ausgelöst.",
        emailSubject: (name) => `Alarm — ${name}`,
        emailIntro:
            "Das Telefon hat nicht bestätigt, dass der Alarm angezeigt wurde. Die Sirene läuft weiter lokal.",
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

export function getSirenAlarmTexts(lang) {
    const pack = ALARM_I18N[normalizeAlarmLang(lang)];
    return {
        title: pack.sirenTitle,
        body: pack.siren,
        emailSubject: pack.sirenTitle,
        emailIntro: pack.emailIntro,
    };
}
