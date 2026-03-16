# Публикуване в Google Play (Trusted Web Activity)

Този документ описва стъпките да издадеш уеб приложението като Android ап в Google Play.

---

## Докато чакаш SSL сертификата (домейнът да стане активен)

Можеш да подготвиш почти всичко **без** жив HTTPS сайт. След като домейнът е с валиден сертификат, остава само да качиш сайта, да генерираш Android пакета и да попълниш Digital Asset Links.

### 1. Регистрация в Google Play Console
- Влез в **https://play.google.com/console**
- Регистрирай се като разработчик (еднократна такса **$25**)
- Създай **ново приложение** → избери име (напр. „Aura HomeSystems“), език по подразбиране, тип (App), без реклами ако нямаш

### 2. Текстове за Store listing (можеш да ги напишеш веднага)
Подготви в отделен документ или в Play Console (ще ги въведеш при първия release):

- **Кратко описание** (до 80 символа), напр.:  
  „Умни сензори за врати и прозорци – мигновени известия на телефона.“

- **Пълно описание** (до 4000 символа): какво прави приложението, за кого е, основни функции (сензори, известия, табло), линк към сайта/поддръжка

- **Какво е новото** (при бъдещи обновления): по избор

### 3. Графики за Play Store (подготви файловете)
- **App icon** – вече имаш `icons/icon-512.png` (512×512 PNG)
- **Feature graphic** – **1024×500** px, JPG или PNG (банер в горната част на страницата в Play). Може да е лого + слоган или визуализация на продукта
- **Снимки на екрана (screenshots)** – минимум **2**, препоръчително 4–8:
  - Телефон: минимум **320–3840 px** по дългата страна (напр. 1080×1920 или 1440×2560)
  - Можеш да снимаш екрана на сайта на телефона (Chrome → „Добави към начален екран“ → отвори и прави screenshots) или да използваш емулатор/десктоп и да подредиш в шаблон

Можеш да правиш снимки от локалния сайт (localhost) или от staging – важни са съдържанието и размерите.

### 4. Политики и настройки (да ги прегледаш/попълниш)
- **Privacy policy** – вече имаш страница `privacy.html`. След като домейнът е жив, URL ще е:  
  `https://www.aurahomesystems.eu/privacy.html`  
  Запиши го и го въведи в Play Console при първия release.

- **Content rating** – попълни анкетата в Console („Content rating“ → започни). Обикновено за такова приложение се избира „Everyone“ или подобно, в зависимост от въпросите.

- **Target audience** – изберете възрастова група (напр. 18+ или „всички“ в зависимост от анкетата).

- **App access** – ако има части зад логин, опиши как тестовите акаунти могат да получат достъп (или че приложението е достъпно без логин за маркетинг частта).

### 5. Проверка на проекта (без жив домейн)
- Увери се, че в проекта има:
  - `manifest.json` с правилно име и икони
  - папка `icons/` с `icon-192.png` и `icon-512.png`
  - `.well-known/assetlinks.json` (шаблонът – package name и SHA256 ще попълниш след като сглобиш ап-а)
- Реши **Package ID** веднъж завинаги, напр. **`com.aurahomesystems.app`** – ще го използваш в PWA Builder и в `assetlinks.json`.

### 6. След като домейнът е с HTTPS
1. Качи целия сайт (вкл. `manifest.json`, `icons/`, `.well-known/assetlinks.json`).
2. В PWA Builder въведи `https://www.aurahomesystems.eu` → Package for stores → Android → задай Package ID → Generate.
3. Сглоби AAB, вземи SHA-256 от ключа за подписване, попълни `assetlinks.json` на сървъра.
4. В Play Console качи AAB, свържи store listing и изпрати за преглед.

---

## Какво е направено в проекта

- **manifest.json** – Web App Manifest за PWA (име, икони, start URL, standalone).
- **Линк към manifest** в `index.html`, `login.html`, `register.html`, `dashboard.html`.
- **.well-known/assetlinks.json** – шаблон за Digital Asset Links (задължително за TWA).

---

## Стъпка 1: Икони за приложението

За manifest и Play Store са нужни поне **192×192** и **512×512** PNG икони.

1. Създай папка `icons` в корена на проекта (ако я няма).
2. Добави файлове:
   - `icons/icon-192.png` (192×192 px)
   - `icons/icon-512.png` (512×512 px)

Можеш да генерираш всички размери от една картинка тук:  
https://www.pwabuilder.com/imageGenerator

След това качи тези файлове на сървъра заедно с останалите файлове на сайта.

---

## Стъпка 2: Качи сайта на домейна си

Увери се, че целият сайт (вкл. `manifest.json` и папката `icons`) е достъпен по **HTTPS** на твоя домейн, например:

- `https://твоят-домейн.com/`
- `https://твоят-домейн.com/manifest.json`
- `https://твоят-домейн.com/icons/icon-192.png`

---

## Стъпка 3: Генериране на Android проект с PWA Builder

1. Отвори **https://www.pwabuilder.com/**
2. В полето за URL въведи твоя домейн (напр. `https://твоят-домейн.com`) и натисни **Start**.
3. PWA Builder ще прочете `manifest.json` и иконите. Ако нещо липсва (напр. икони), попълни го в сайта или в предложенията на PWA Builder.
4. Натисни **Package for stores** → избери **Android**.
5. Задай **Package ID** (напр. `com.aurahomesystems.app` или `com.tvoyadomain.app`) – този идентификатор не трябва да се променя после.
6. Натисни **Generate** и изтегли ZIP с Android проекта.

---

## Стъпка 4: Сглобяване на APK/AAB

1. Отвори изтегления проект в **Android Studio** (или използвай командния ред с `./gradlew bundleRelease`).
2. Сглоби **Android App Bundle** (.aab) за release (предпочитано за Play Store) или APK.
3. При първо сглобяване ще се създаде ключ за подписване (keystore). **Запази паролата и файла – без тях няма да можеш да обновяваш приложението.**

За SHA-256 отпечатъка на ключа (за стъпка 5):

```bash
keytool -list -v -keystore tvoqt-keystore.jks -alias tvoqt-alias
```

Копирай реда **SHA256:**.

---

## Стъпка 5: Digital Asset Links на домейна

За да работи TWA (приложението да отваря твоя домейн без „не е доверен“), твоят домейн трябва да декларира подписането на ап-а.

1. В проекта отвори **.well-known/assetlinks.json**.
2. Замени:
   - `com.aurahomesystems.app` с реалния **Package ID** от стъпка 3, ако е различен (package name трябва да е само с малки букви).
   - `PASTE_SHA256_FINGERPRINT_...` с **SHA-256 отпечатъка** на ключа за подписване (от keytool или от Play Console – виж по-долу).
3. Качи този файл на сървъра така, че да е достъпен на:
   - `https://твоят-домейн.com/.well-known/assetlinks.json`
4. Заглавката трябва да е: `Content-Type: application/json`.

**Ако използваш Google Play App Signing:** В Play Console → твоето приложение → **Setup** → **App signing** има „App signing key certificate“ – копирай **SHA-256 certificate fingerprint** и го сложи в `sha256_cert_fingerprints` в `assetlinks.json` (формат с двоеточия, напр. `AA:BB:CC:...`).

След като обновиш `assetlinks.json` на сървъра, провери тук дали е наред:  
https://developers.google.com/digital-asset-links/tools/generator

---

## Стъпка 6: Публикуване в Google Play Console

1. Влез в **Google Play Console**: https://play.google.com/console
2. Създай ново приложение (ако нямаш), избери име и език.
3. В **Release** → **Production** (или Testing) създай нов release и качи **Android App Bundle** (.aab) от стъпка 4.
4. Попълни **Store listing**: описание, снимки, категория и т.н.
5. Попълни **Content rating**, **Privacy policy** (линк към твоята политика за поверителност) и всички други задължителни секции.
6. Изпрати за преглед. След одобрение приложението ще е достъпно в Play Store.

---

## Кратък контролен списък

- [ ] Икони 192×192 и 512×512 в `icons/` и на сървъра
- [ ] Сайтът е на HTTPS на твоя домейн
- [ ] Android проект генериран от PWA Builder с правилен Package ID
- [ ] Сглобен .aab (или APK) и запазен keystore
- [ ] На домейна е качен `.well-known/assetlinks.json` с правилен package_name и SHA-256
- [ ] В Play Console е качен .aab и попълнена store listing и останалите изисквания

След това потребителите ще могат да инсталират приложението от Google Play; то ще отваря твоя уеб сайт в пълноекранен режим (TWA).
