const translations = {
    bg: {
        nav: { problem: "Проблем", solution: "Решение", product: "Продукт", stats: "Резултати", cta: "Започни", login: "Вход" },
        hero: {
            eyebrow: "Когато никой не е у дома...",
            title: "Aura HomeSystems пази дома ти, когато е празен.",
            subtitle: "Най-честите кражби стават през прозорците и входната врата. Ние комбинираме умни безжични сензори за прозорци и врати с мобилно приложение, което изпраща мигновени сигнали до телефона ти при всяко нежелано отваряне.",
            cta: "Започни с Aura",
            ctaNote: "Виж как работи системата и как можеш да я инсталираш у дома си"
        },
        scene: { notifOpen: "Прозорецът е отворен", notifSafe: "Входната врата е защитена" },
        problem: {
            title: "Проблемът: домът остава без надзор",
            p1: "Когато семейството е на работа, на почивка или просто извън града, домът остава уязвим и най-често напълно „невидим“ за собствениците. Най-честите кражби се случват през <strong>прозорците</strong> и <strong>входната врата</strong> – точно когато няма кой да реагира навреме и няма реална информация какво се случва вътре.",
            li1: "Никой не вижда опита за взлом в реално време.",
            li2: "Реакцията идва късно – след като щетите вече са нанесени.",
            li3: "Стандартните аларми често остават без връзка със собственика и звучат „в празно пространство“.",
            li4: "Не знаеш дали прозорците и вратите са затворени, когато бързаш за работа или пътуване."
        },
        solution: {
            title: "Нашето решение: умни сензори с реални сигнали",
            p1: "Инсталираме интелигентни сензори на критичните точки – прозорци и входни врати. Те следят статуса им в реално време и при всяка промяна изпращат <strong>незабавно известие до телефона ти</strong>. Получаваш не просто аларма, а ясен сигнал кой отвор е засегнат, кога се е случило и колко дълго е останал отворен.",
            li1: "Следиш в реално време дали е отворено или затворено.",
            li2: "Получаваш ясни известия при всяко съмнително движение.",
            li3: "Можеш да реагираш веднага – независимо къде се намираш."
        },
        product: {
            title: "Какво точно получаваш",
            subtitle: "Aura HomeSystems е завършено решение – от сензора на прозореца до известието на телефона.",
            windowTitle: "Сензори за прозорци",
            windowDesc: "Компактни безжични сензори, които засичат отваряне и оставане отворено. Идеални за тераси, детски стаи и леснодостъпни прозорци.",
            doorTitle: "Сензори за входни врати",
            doorDesc: "Устойчиви сензори за входни и гаражни врати, които предупреждават при всяко неочаквано отключване или отваряне.",
            appTitle: "Мобилно приложение",
            appDesc: "Виждаш в реално време статуса на всеки сензор, получаваш известия и история на събитията – директно на телефона си.",
            wifiNote: "За да използваш сензорите ни, в дома ти трябва да има стабилна WiFi връзка – сензорите се свързват с нея и изпращат данните до приложението."
        },
        cases: {
            title: "Как изглежда Aura у дома",
            subtitle: "Няколко реални сценария, в които системата работи за теб – дори когато ти не мислиш за нея.",
            terraceLabel: "Хол с тераса",
            terraceTitle: "Хол с тераса",
            terraceDesc: "Сензор на плъзгащата врата към терасата те предупреждава, ако остане отворена след вечеря или ако някой я отвори през нощта, докато семейството спи.",
            entranceLabel: "Основен вход",
            entranceTitle: "Основен вход",
            entranceDesc: "Сензор на входната врата отчита всяко отваряне, докато си на работа. При неочаквано отключване получаваш моментално известие на телефона си.",
            kidsLabel: "Детска стая",
            kidsTitle: "Детска стая",
            kidsDesc: "Сензор на прозореца в детската стая ти дава спокойствие, че прозорецът не остава отворен, когато децата играят вътре или когато навън е студено."
        },
        stats: {
            title: "Довериха ни се десетки домакинства",
            subtitle: "Нашите решения вече работят в реални домове и обекти. Бавно, но сигурно, разширяваме мрежата си и пазим все повече хора.",
            cities: "града",
            citiesHelp: "В които вече сме инсталирали системи",
            projects: "успешни проекта",
            projectsHelp: "Завършени решения „до ключ“",
            clients: "доволни клиенти",
            clientsHelp: "С по-спокоен сън и защитен дом"
        },
        testimonials: {
            title: "Какво казват клиентите ни",
            subtitle: "Доволни собственици на Aura HomeSystems споделят как приложението и сензорите им промениха спокойствието у дома.",
            t1: "„Приложението е изключително лесно – виждам веднага кой прозорец или врата е отворена. През зимата веднъж забравихме да затворим терасата и известието дойде мигновено. Наистина спокойствие за цялото семейство.“",
            t1Name: "Мария К.",
            t1Meta: "София, инсталация от 6 месеца",
            t2: "„Работя често на командировки и преди се притенявах за дома. Сега с Aura виждам статуса на всички входове в реално време. Приложението работи стабилно и известията са ясни – препоръчвам го с две ръце.“",
            t2Name: "Иван П.",
            t2Meta: "Пловдив, клиент от 1 година",
            t3: "„Инсталирахме сензори на детската и на входната врата. Приложението е много интуитивно – дори бабата си проверява дали всичко е затворено преди лягане. Добре дошли в 21 век, без да е сложно.“",
            t3Name: "Елена и Димитър Т.",
            t3Meta: "Варна, доволни клиенти"
        },
        cta: {
            title: "Готов ли си да защитиш дома си?",
            subtitle: "Разкажи ни с какво жилище разполагаш и ще ти предложим конкретна конфигурация от сензори за врати и прозорци.",
            step1: "Споделяш ни колко стаи, прозорци и входни врати имаш.",
            step2: "Предлагаме ти примерен пакет сензори и ориентировъчна цена.",
            step3: "Планираме инсталация и те превеждаме през приложението стъпка по стъпка.",
            link: "Заяви безплатна консултация по имейл"
        },
        form: {
            title: "Заглавие",
            message: "Съобщение",
            phone: "Телефон",
            email: "Имейл",
            submit: "Изпрати запитване",
            titlePlaceholder: "напр. Запитване за сензори",
            messagePlaceholder: "Напишете вашето съобщение...",
            phonePlaceholder: "+359 888 123 456",
            emailPlaceholder: "your@email.com"
        },
        footer: { text: "Умни сензори за по-спокоен дом.", wifiNote: "За да използваш нашите сензори, необходима е стабилна WiFi връзка у дома.", impressum: "Импресум" }
    },
    en: {
        nav: { problem: "Problem", solution: "Solution", product: "Product", stats: "Results", cta: "Get started", login: "Login" },
        hero: {
            eyebrow: "When nobody's home...",
            title: "Aura HomeSystems keeps your home safe when it's empty.",
            subtitle: "Most break-ins happen through windows and the front door. We combine smart wireless sensors for windows and doors with a mobile app that sends instant alerts to your phone whenever something opens.",
            cta: "Get started with Aura",
            ctaNote: "See how the system works and how you can install it at home"
        },
        scene: { notifOpen: "Window is open", notifSafe: "Front door is secure" },
        problem: {
            title: "The problem: your home is left unwatched",
            p1: "When the family is at work, on holiday or simply away, the home is vulnerable and often completely \"invisible\" to the owners. Most break-ins happen through <strong>windows</strong> and the <strong>front door</strong> – exactly when there's no one to react in time and no real information about what's going on inside.",
            li1: "No one sees the break-in attempt in real time.",
            li2: "Reaction comes too late – after the damage is done.",
            li3: "Standard alarms often have no link to the owner and just sound into empty space.",
            li4: "You don't know if windows and doors are closed when you rush to work or travel."
        },
        solution: {
            title: "Our solution: smart sensors with real alerts",
            p1: "We install intelligent sensors at critical points – windows and entrance doors. They monitor their status in real time and send <strong>instant notifications to your phone</strong> on any change. You get more than an alarm: a clear signal of which opening was affected, when it happened, and how long it stayed open.",
            li1: "You see in real time whether each point is open or closed.",
            li2: "You get clear notifications for any suspicious activity.",
            li3: "You can react immediately – wherever you are."
        },
        product: {
            title: "What you get",
            subtitle: "Aura HomeSystems is a complete solution – from the window sensor to the notification on your phone.",
            windowTitle: "Window sensors",
            windowDesc: "Compact wireless sensors that detect opening and staying open. Ideal for terraces, kids' rooms, and easily accessible windows.",
            doorTitle: "Entrance door sensors",
            doorDesc: "Robust sensors for entrance and garage doors that alert you to any unexpected unlock or opening.",
            appTitle: "Mobile app",
            appDesc: "See each sensor's status in real time, get notifications and event history – right on your phone.",
            wifiNote: "To use our sensors, you need a stable WiFi connection at home – the sensors connect to it and send data to the app."
        },
        cases: {
            title: "What Aura looks like at home",
            subtitle: "A few real scenarios where the system works for you – even when you're not thinking about it.",
            terraceLabel: "Living room with terrace",
            terraceTitle: "Living room with terrace",
            terraceDesc: "A sensor on the sliding door to the terrace warns you if it stays open after dinner or if someone opens it at night while the family sleeps.",
            entranceLabel: "Main entrance",
            entranceTitle: "Main entrance",
            entranceDesc: "A sensor on the front door logs every opening while you're at work. If it's unlocked unexpectedly, you get an instant notification on your phone.",
            kidsLabel: "Children's room",
            kidsTitle: "Children's room",
            kidsDesc: "A sensor on the window in the kids' room gives you peace of mind that the window isn't left open when the children play inside or when it's cold outside."
        },
        stats: {
            title: "Dozens of households trust us",
            subtitle: "Our solutions already run in real homes and sites. Slowly but surely we're expanding and protecting more people.",
            cities: "cities",
            citiesHelp: "Where we've already installed systems",
            projects: "successful projects",
            projectsHelp: "Turnkey solutions completed",
            clients: "happy clients",
            clientsHelp: "With peace of mind and a protected home"
        },
        testimonials: {
            title: "What our clients say",
            subtitle: "Happy Aura HomeSystems owners share how the app and sensors changed their peace of mind at home.",
            t1: "\"The app is incredibly easy – I see right away which window or door is open. Once in winter we forgot to close the terrace and the alert came instantly. Real peace of mind for the whole family.\"",
            t1Name: "Maria K.",
            t1Meta: "Sofia, installation 6 months ago",
            t2: "\"I often travel for work and used to worry about the house. With Aura I see the status of all entry points in real time. The app is stable and the notifications are clear – I recommend it wholeheartedly.\"",
            t2Name: "Ivan P.",
            t2Meta: "Plovdiv, client for 1 year",
            t3: "\"We installed sensors in the kids' room and on the front door. The app is very intuitive – even grandma checks that everything is closed before bed. Welcome to the 21st century without the hassle.\"",
            t3Name: "Elena & Dimitar T.",
            t3Meta: "Varna, happy clients"
        },
        cta: {
            title: "Ready to protect your home?",
            subtitle: "Tell us about your home and we'll suggest a concrete sensor setup for doors and windows.",
            step1: "You tell us how many rooms, windows and entrance doors you have.",
            step2: "We propose a sample sensor package and indicative price.",
            step3: "We plan the installation and guide you through the app step by step.",
            link: "Request a free consultation by email"
        },
        form: {
            title: "Subject",
            message: "Message",
            phone: "Phone",
            email: "Email",
            submit: "Send inquiry",
            titlePlaceholder: "e.g. Inquiry about sensors",
            messagePlaceholder: "Write your message...",
            phonePlaceholder: "+1 234 567 890",
            emailPlaceholder: "your@email.com"
        },
        footer: { text: "Smart sensors for a calmer home.", wifiNote: "A stable WiFi connection at home is required to use our sensors.", impressum: "Impressum" }
    },
    de: {
        nav: { problem: "Problem", solution: "Lösung", product: "Produkt", stats: "Ergebnisse", cta: "Loslegen", login: "Anmelden" },
        hero: {
            eyebrow: "Wenn niemand zu Hause ist...",
            title: "Aura HomeSystems schützt Ihr Zuhause, wenn es leer steht.",
            subtitle: "Die meisten Einbrüche passieren über Fenster und Haustür. Wir kombinieren smarte funkbasierte Sensoren für Fenster und Türen mit einer App, die Ihnen sofort eine Nachricht aufs Handy schickt, sobald etwas geöffnet wird.",
            cta: "Mit Aura starten",
            ctaNote: "Erfahren Sie, wie das System funktioniert und wie Sie es bei sich einbauen können"
        },
        scene: { notifOpen: "Fenster ist offen", notifSafe: "Haustür ist gesichert" },
        problem: {
            title: "Das Problem: Das Zuhause bleibt unbeaufsichtigt",
            p1: "Wenn die Familie arbeitet, im Urlaub oder einfach unterwegs ist, ist das Zuhause gefährdet und oft völlig „unsichtbar“ für die Besitzer. Die meisten Einbrüche geschehen über <strong>Fenster</strong> und <strong>Haustür</strong> – genau wenn niemand rechtzeitig reagieren kann und keine echten Infos da sind, was drinnen passiert.",
            li1: "Niemand sieht den Einbruchversuch in Echtzeit.",
            li2: "Die Reaktion kommt zu spät – wenn der Schaden schon da ist.",
            li3: "Normale Alarmanlagen hängen oft nicht mit dem Besitzer zusammen und läuten ins Leere.",
            li4: "Sie wissen nicht, ob Fenster und Türen zu sind, wenn Sie zur Arbeit hetzen oder verreisen."
        },
        solution: {
            title: "Unsere Lösung: smarte Sensoren mit echten Signalen",
            p1: "Wir installieren intelligente Sensoren an kritischen Stellen – Fenster und Eingangstüren. Sie überwachen den Status in Echtzeit und schicken bei jeder Änderung <strong>sofort eine Benachrichtigung auf Ihr Handy</strong>. Sie bekommen nicht nur Alarm, sondern ein klares Signal: welcher Öffner betroffen ist, wann es passiert ist und wie lange es offen war.",
            li1: "Sie sehen in Echtzeit, ob etwas offen oder geschlossen ist.",
            li2: "Sie bekommen klare Benachrichtigungen bei verdächtigen Bewegungen.",
            li3: "Sie können sofort reagieren – egal wo Sie sind."
        },
        product: {
            title: "Was Sie bekommen",
            subtitle: "Aura HomeSystems ist eine Komplettlösung – vom Fenstersensor bis zur Benachrichtigung auf dem Handy.",
            windowTitle: "Fenstersensoren",
            windowDesc: "Kompakte funkbasierte Sensoren, die Öffnen und Offenbleiben erfassen. Ideal für Terrassen, Kinderzimmer und gut erreichbare Fenster.",
            doorTitle: "Eingangstür-Sensoren",
            doorDesc: "Robuste Sensoren für Eingangs- und Garagentüren, die bei unerwartetem Öffnen oder Aufschließen warnen.",
            appTitle: "Mobile App",
            appDesc: "Sie sehen in Echtzeit den Status jedes Sensors, bekommen Benachrichtigungen und Verlauf – direkt auf dem Handy.",
            wifiNote: "Für die Nutzung unserer Sensoren ist eine stabile WLAN-Verbindung zu Hause nötig – die Sensoren verbinden sich damit und senden die Daten an die App."
        },
        cases: {
            title: "So sieht Aura bei Ihnen aus",
            subtitle: "Einige reale Szenarien, in denen das System für Sie arbeitet – auch wenn Sie nicht dran denken.",
            terraceLabel: "Wohnzimmer mit Terrasse",
            terraceTitle: "Wohnzimmer mit Terrasse",
            terraceDesc: "Ein Sensor an der Terrassentür warnt Sie, wenn sie nach dem Abendessen offen bleibt oder nachts jemand öffnet, während die Familie schläft.",
            entranceLabel: "Haupteingang",
            entranceTitle: "Haupteingang",
            entranceDesc: "Ein Sensor an der Haustür erfasst jede Öffnung, während Sie arbeiten. Bei unerwartetem Aufschließen erhalten Sie sofort eine Nachricht aufs Handy.",
            kidsLabel: "Kinderzimmer",
            kidsTitle: "Kinderzimmer",
            kidsDesc: "Ein Sensor am Fenster im Kinderzimmer gibt Ihnen die Gewissheit, dass das Fenster nicht offen bleibt, wenn die Kinder drinnen spielen oder es draußen kalt ist."
        },
        stats: {
            title: "Dutzende Haushalte vertrauen uns",
            subtitle: "Unsere Lösungen laufen bereits in echten Wohnungen und Objekten. Langsam aber sicher erweitern wir und schützen mehr Menschen.",
            cities: "Städte",
            citiesHelp: "In denen wir bereits Anlagen installiert haben",
            projects: "erfolgreiche Projekte",
            projectsHelp: "Abgeschlossene Komplettlösungen",
            clients: "zufriedene Kunden",
            clientsHelp: "Mit ruhigerem Schlaf und geschütztem Zuhause"
        },
        testimonials: {
            title: "Was unsere Kunden sagen",
            subtitle: "Zufriedene Aura-Hausbesitzer berichten, wie App und Sensoren ihre Ruhe zu Hause verändert haben.",
            t1: "„Die App ist extrem einfach – ich sehe sofort, welches Fenster oder welche Tür offen ist. Im Winter haben wir einmal die Terrasse nicht geschlossen, die Meldung kam sofort. Wirklich Ruhe für die ganze Familie.“",
            t1Name: "Maria K.",
            t1Meta: "Sofia, Installation vor 6 Monaten",
            t2: "„Ich bin oft geschäftlich unterwegs und habe mich früher ums Haus gesorgt. Mit Aura sehe ich den Status aller Zugänge in Echtzeit. Die App läuft stabil, die Meldungen sind klar – ich empfehle sie von Herzen.“",
            t2Name: "Ivan P.",
            t2Meta: "Plowdiw, Kunde seit 1 Jahr",
            t3: "„Wir haben Sensoren im Kinderzimmer und an der Haustür. Die App ist sehr intuitiv – sogar Oma prüft vor dem Schlafen, ob alles zu ist. Willkommen im 21. Jahrhundert, ohne Stress.“",
            t3Name: "Elena & Dimitar T.",
            t3Meta: "Warna, zufriedene Kunden"
        },
        cta: {
            title: "Bereit, Ihr Zuhause zu schützen?",
            subtitle: "Erzählen Sie uns von Ihrer Wohnung, wir schlagen eine konkrete Sensor-Ausstattung für Türen und Fenster vor.",
            step1: "Sie sagen uns, wie viele Zimmer, Fenster und Eingangstüren Sie haben.",
            step2: "Wir schlagen ein Beispiel-Paket und einen Richtpreis vor.",
            step3: "Wir planen die Installation und führen Sie Schritt für Schritt durch die App.",
            link: "Kostenlose Beratung per E-Mail anfragen"
        },
        form: {
            title: "Betreff",
            message: "Nachricht",
            phone: "Telefon",
            email: "E-Mail",
            submit: "Anfrage senden",
            titlePlaceholder: "z. B. Anfrage zu Sensoren",
            messagePlaceholder: "Schreiben Sie Ihre Nachricht...",
            phonePlaceholder: "+49 123 456789",
            emailPlaceholder: "ihre@email.de"
        },
        footer: { text: "Smarte Sensoren für ein ruhigeres Zuhause.", wifiNote: "Für unsere Sensoren ist eine stabile WLAN-Verbindung zu Hause erforderlich.", impressum: "Impressum" }
    }
};

function getTranslation(lang, key) {
    const parts = key.split(".");
    let o = translations[lang] || translations.bg;
    for (const p of parts) {
        o = o ? o[p] : undefined;
    }
    return o != null ? String(o) : key;
}
