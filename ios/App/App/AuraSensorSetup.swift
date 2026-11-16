import CoreBluetooth
import Capacitor
import NetworkExtension
import UIKit

class AuraBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(AuraSetupPlugin())
    }
}

@objc(AuraSetupPlugin)
public class AuraSetupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AuraSetupPlugin"
    public let jsName = "AuraSetup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    @objc func open(_ call: CAPPluginCall) {
        let email = call.getString("email") ?? ""
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The setup screen is not available.")
                return
            }
            let setup = AuraSetupController(email: email)
            // Sensors already on the account. The sensor id comes from its name, so a second
            // sensor with the same name would replace the first one.
            let existing = (call.getArray("existingIds") as? [String]) ?? []
            setup.setExistingSensorIds(existing)
            setup.modalPresentationStyle = .fullScreen
            setup.onClose = { paired, name in
                call.resolve([
                    "paired": paired,
                    "name": name
                ])
            }
            presenter.present(setup, animated: true)
        }
    }
}

final class AuraSetupController: UIViewController, CBCentralManagerDelegate, CBPeripheralDelegate, UITextFieldDelegate {
    private let setupApSsid = "AuraHomeSystems_Setup"
    /// Same as SETUP_AP_PASS on the sensor. The customer never types it.
    private let setupApPass = "AuraSetup"
    private let pingUrl = URL(string: "http://192.168.4.1/ping")!
    private let wifiUrl = URL(string: "http://192.168.4.1/wifi")!
    private let provUrl = URL(string: "http://192.168.4.1/prov")!
    private let service = CBUUID(string: "8a1f0001-7c3a-4b2e-9d11-0e5a6b7c8d01")
    private let listId = CBUUID(string: "8a1f0002-7c3a-4b2e-9d11-0e5a6b7c8d01")
    private let credId = CBUUID(string: "8a1f0003-7c3a-4b2e-9d11-0e5a6b7c8d01")
    private let statId = CBUUID(string: "8a1f0004-7c3a-4b2e-9d11-0e5a6b7c8d01")
    private let email: String
    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var credsSent = false
    private var finishedOk = false
    private var softApMode = false
    private var softApReady = false
    private var softApFallbackWork: DispatchWorkItem?
    private var lastJoinErrorInfo = ""
    private var softApPollTimer: Timer?
    private var softApGuideNote = ""
    /// True once the sensor has finished scanning Wi-Fi (Connect stays disabled before).
    private var bleListReady = false
    private var returnCountdown: Timer?
    /// False while the sensor is still searching for Wi-Fi networks.
    private var networksReady = false

    /// Step by step: network first, then its password, then the sensor name and Connect.
    @objc private func formFieldChanged() {
        updateFormState()
    }

    private func updateFormState() {
        // Only while the Wi-Fi form is on screen (not during search, progress or the guide).
        guard !form.isHidden, !credsSent else { return }
        let hasNetwork = !(ssidField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasPass = !(passField.text ?? "").isEmpty
        let nameOpen = networksReady && hasNetwork && hasPass
        // A name that is already used would replace that sensor: do not allow it.
        let taken = nameOpen && sensorNameTaken()
        let canConnect = nameOpen && !taken
        if taken {
            detail.text = "You already have a sensor named “\(effectiveSensorName())”. Please choose a different name."
            nameWarningShown = true
        } else if nameWarningShown {
            nameWarningShown = false
            detail.text = "1. Choose your home Wi-Fi  2. Enter its password  3. Name the sensor"
        }
        passField.isEnabled = networksReady && hasNetwork
        passField.alpha = passField.isEnabled ? 1 : 0.45
        nameField.isEnabled = nameOpen
        nameField.alpha = nameOpen ? 1 : 0.45
        connectButton.setTitle(networksReady ? "Connect" : "Searching…", for: .normal)
        connectButton.isEnabled = canConnect
        connectButton.alpha = canConnect ? 1 : 0.45
    }
    /// SoftAP has no internet — block cellular so requests hit 192.168.4.1 on Wi‑Fi.
    private lazy var softApSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.allowsCellularAccess = false
        config.waitsForConnectivity = false
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 90
        return URLSession(configuration: config)
    }()

    private let pageBg = UIColor(red: 15 / 255, green: 23 / 255, blue: 42 / 255, alpha: 1)
    private let scrollView = UIScrollView()
    private let brand = UILabel()
    private let headline = UILabel()
    private let detail = UILabel()
    private let percent = UILabel()
    private let searchLogo = UIImageView()
    private let magnets = MagnetMark()
    private var shownPct = 0
    private var targetPct = 0
    private var magnetTimer: Timer?
    private let ssidField = UITextField()
    private let passField = UITextField()
    private let nameField = UITextField()
    private let networks = UIStackView()
    private let form = UIStackView()
    private let refreshNetworksButton = UIButton(type: .system)
    private let connectButton = UIButton(type: .system)
    /// Separate from Connect — only visible after progress hits 100%.
    private let returnButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    private var connectingProgress = false
    private var softApJoinWatchdog: UUID?
    private var lastProvisionedName = ""
    private var scrollBottomConstraint: NSLayoutConstraint?
    private var looking = true
    private var lookingSince = Date()
    private var scanPass = 0
    private var lookingTimer: Timer?
    private var scanRefreshWork: DispatchWorkItem?
    /// paired + sensor name when Connect finished OK (for dashboard to clear Remove tombstones).
    var onClose: ((_ paired: Bool, _ name: String) -> Void)?

    init(email: String) {
        self.email = email
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        return nil
    }

    private var existingSensorKeys = Set<String>()
    private var nameWarningShown = false

    /// Same rule as the sensor and dashboard: the id is the name with a few characters replaced.
    private static func sensorKey(_ name: String) -> String {
        var s = name.trimmingCharacters(in: .whitespacesAndNewlines)
        for ch in [".", "$", "#", "[", "]", "/", "@"] {
            s = s.replacingOccurrences(of: ch, with: "_")
        }
        s = s.replacingOccurrences(of: "\\s+", with: "_", options: .regularExpression)
        s = s.replacingOccurrences(of: "-+", with: "_", options: .regularExpression)
        return s.lowercased()
    }

    func setExistingSensorIds(_ ids: [String]) {
        existingSensorKeys = Set(ids.map { Self.sensorKey($0) })
    }

    private func effectiveSensorName() -> String {
        let name = (nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? "Front Door" : name
    }

    private func sensorNameTaken() -> Bool {
        existingSensorKeys.contains(Self.sensorKey(effectiveSensorName()))
    }

    /// Suggest a free name ("Front Door 2") when the default name is already used.
    private func suggestFreeSensorName() {
        guard sensorNameTaken() else { return }
        let base = effectiveSensorName()
        var n = 2
        while existingSensorKeys.contains(Self.sensorKey("\(base) \(n)")) { n += 1 }
        nameField.text = "\(base) \(n)"
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        magnetTimer?.invalidate()
        lookingTimer?.invalidate()
        scanRefreshWork?.cancel()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = pageBg
        brand.text = "Aura HomeSystems"
        brand.textColor = UIColor(red: 0.58, green: 0.64, blue: 0.72, alpha: 1)
        brand.font = .systemFont(ofSize: 13, weight: .regular)
        brand.textAlignment = .center
        headline.textColor = UIColor(red: 0.97, green: 0.98, blue: 0.99, alpha: 1)
        headline.font = .systemFont(ofSize: 24, weight: .medium)
        headline.textAlignment = .center
        headline.numberOfLines = 0
        detail.textColor = UIColor(red: 0.80, green: 0.84, blue: 0.88, alpha: 1)
        detail.font = .systemFont(ofSize: 15)
        detail.textAlignment = .center
        detail.numberOfLines = 0
        percent.textColor = UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1)
        percent.font = .systemFont(ofSize: 52, weight: .regular)
        percent.textAlignment = .center
        percent.isHidden = true
        // Same mark as Android setup / App Icon.
        searchLogo.image = UIImage(named: "AuraMark")
        searchLogo.contentMode = .scaleAspectFill
        searchLogo.clipsToBounds = true
        searchLogo.backgroundColor = pageBg
        searchLogo.layer.cornerRadius = 48
        searchLogo.translatesAutoresizingMaskIntoConstraints = false
        searchLogo.widthAnchor.constraint(equalToConstant: 96).isActive = true
        searchLogo.heightAnchor.constraint(equalToConstant: 96).isActive = true
        magnets.isHidden = true
        magnets.translatesAutoresizingMaskIntoConstraints = false
        magnets.widthAnchor.constraint(equalToConstant: 168).isActive = true
        magnets.heightAnchor.constraint(equalToConstant: 168).isActive = true
        form.axis = .vertical
        form.spacing = 8
        form.isHidden = true
        networks.axis = .vertical
        networks.spacing = 2
        style(ssidField, placeholder: "Wi-Fi name")
        style(passField, placeholder: "Password")
        passField.isSecureTextEntry = true
        style(nameField, placeholder: "Front Door")
        nameField.text = "Front Door"
        ssidField.returnKeyType = .next
        passField.returnKeyType = .next
        nameField.returnKeyType = .done
        ssidField.delegate = self
        passField.delegate = self
        nameField.delegate = self
        attachKeyboardToolbar(to: ssidField)
        attachKeyboardToolbar(to: passField)
        attachKeyboardToolbar(to: nameField)
        refreshNetworksButton.setTitle("Refresh networks", for: .normal)
        refreshNetworksButton.setTitleColor(UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1), for: .normal)
        refreshNetworksButton.contentHorizontalAlignment = .leading
        refreshNetworksButton.addTarget(self, action: #selector(refreshNetworksTapped), for: .touchUpInside)
        connectButton.setTitle("Connect", for: .normal)
        connectButton.setTitleColor(.white, for: .normal)
        connectButton.backgroundColor = UIColor(red: 0.09, green: 0.64, blue: 0.29, alpha: 1)
        connectButton.layer.cornerRadius = 12
        connectButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
        connectButton.isHidden = true

        returnButton.setTitle("Back to dashboard", for: .normal)
        returnButton.setTitleColor(.white, for: .normal)
        returnButton.backgroundColor = UIColor(red: 0.09, green: 0.64, blue: 0.29, alpha: 1)
        returnButton.layer.cornerRadius = 12
        returnButton.heightAnchor.constraint(equalToConstant: 48).isActive = true
        returnButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        returnButton.isHidden = true
        returnButton.isEnabled = false

        closeButton.setTitle("Close", for: .normal)
        closeButton.setTitleColor(UIColor(white: 0.7, alpha: 1), for: .normal)
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(closeButton)

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.backgroundColor = pageBg
        view.addSubview(scrollView)

        let stack = UIStackView(arrangedSubviews: [brand, searchLogo, percent, headline, detail, magnets, form, connectButton, returnButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)

        let bottom = scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        scrollBottomConstraint = bottom
        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            closeButton.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: closeButton.bottomAnchor, constant: 8),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottom,
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -28),
            form.widthAnchor.constraint(equalTo: stack.widthAnchor),
            connectButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            returnButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            headline.widthAnchor.constraint(equalTo: stack.widthAnchor),
            detail.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
        form.addArrangedSubview(caption("Network"))
        form.addArrangedSubview(ssidField)
        form.addArrangedSubview(networks)
        form.addArrangedSubview(refreshNetworksButton)
        form.addArrangedSubview(caption("Password"))
        form.addArrangedSubview(passField)
        form.addArrangedSubview(caption("Sensor name"))
        form.addArrangedSubview(nameField)
        form.addArrangedSubview(caption("Choose the 2.4 GHz network."))

        let tap = UITapGestureRecognizer(target: self, action: #selector(dismissKeyboard))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillChange(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        ssidField.addTarget(self, action: #selector(formFieldChanged), for: .editingChanged)
        passField.addTarget(self, action: #selector(formFieldChanged), for: .editingChanged)
        nameField.addTarget(self, action: #selector(formFieldChanged), for: .editingChanged)

        headline.text = "Looking for the sensor"
        looking = true
        lookingSince = Date()
        scanPass = 0
        updateLookingDetail()
        startSearchSpinner()
        startLookingTick()
        central = CBCentralManager(delegate: self, queue: nil)
        // Drop a broken saved network now, long before the join, so apply() is not racing it.
        clearStaleSetupConfigs {}
        // The sensor offers Bluetooth for 15 s, then Wi-Fi for 30 s, in turns. Bluetooth is the
        // normal way (no Wi-Fi switching). The manual Wi-Fi guide is only the last resort.
        let work = DispatchWorkItem { [weak self] in self?.startSoftApSetup() }
        softApFallbackWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 90, execute: work)
    }

    private func startLookingTick() {
        lookingTimer?.invalidate()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            self?.updateLookingDetail()
        }
        lookingTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    private func stopLookingTick() {
        looking = false
        lookingTimer?.invalidate()
        lookingTimer = nil
        scanRefreshWork?.cancel()
        scanRefreshWork = nil
    }

    private func updateLookingDetail() {
        guard looking, !softApMode, peripheral == nil, !finishedOk else { return }
        let sec = max(0, Int(Date().timeIntervalSince(lookingSince)))
        var text = "Searching… \(sec)s · Scan #\(max(scanPass, 1))"
        if sec >= 90 {
            text += " — If nothing: phone Wi-Fi → AuraHomeSystems_Setup → 192.168.4.1"
        } else {
            text += " — keep the sensor next to you"
        }
        detail.text = text
    }

    private func beginBleScanPass() {
        guard looking, !softApMode, !finishedOk, peripheral == nil else { return }
        guard central.state == .poweredOn else { return }
        central.stopScan()
        scanPass += 1
        central.scanForPeripherals(withServices: [service], options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: true
        ])
        updateLookingDetail()
        scanRefreshWork?.cancel()
        let refresh = DispatchWorkItem { [weak self] in
            self?.beginBleScanPass()
        }
        scanRefreshWork = refresh
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.5, execute: refresh)
    }

    @objc private func dismissKeyboard() {
        view.endEditing(true)
    }

    private func attachKeyboardToolbar(to field: UITextField) {
        let bar = UIToolbar()
        bar.sizeToFit()
        let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let done = UIBarButtonItem(title: "Done", style: .done, target: self, action: #selector(dismissKeyboard))
        bar.items = [flex, done]
        field.inputAccessoryView = bar
    }

    @objc private func keyboardWillChange(_ note: Notification) {
        guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let kb = view.convert(frame, from: nil)
        let overlap = max(0, view.bounds.maxY - kb.minY)
        let inset = UIEdgeInsets(top: 0, left: 0, bottom: overlap + 12, right: 0)
        scrollView.contentInset = inset
        scrollView.verticalScrollIndicatorInsets = inset
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let target = self.connectButton.isHidden ? (self.nameField.isFirstResponder ? self.nameField : self.passField.isFirstResponder ? self.passField : self.ssidField) : self.connectButton
            self.scrollView.scrollRectToVisible(target.convert(target.bounds.insetBy(dx: 0, dy: -24), to: self.scrollView), animated: true)
        }
    }

    @objc private func keyboardWillHide(_ note: Notification) {
        scrollView.contentInset = .zero
        scrollView.verticalScrollIndicatorInsets = .zero
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        if textField === ssidField {
            passField.becomeFirstResponder()
        } else if textField === passField {
            nameField.becomeFirstResponder()
        } else {
            dismissKeyboard()
            if !connectButton.isHidden && connectButton.isEnabled {
                scrollView.scrollRectToVisible(connectButton.convert(connectButton.bounds, to: scrollView), animated: true)
            }
        }
        return true
    }

    @objc private func refreshNetworksTapped() {
        dismissKeyboard()
        detail.text = "Loading Wi-Fi list…"
        networksReady = false
        updateFormState()
        refreshNetworksButton.isEnabled = false
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.fetchWifiList(retries: 4)
            DispatchQueue.main.async { self?.refreshNetworksButton.isEnabled = true }
        }
    }

    private func startSearchSpinner() {
        searchLogo.isHidden = false
        searchLogo.layer.removeAnimation(forKey: "spin")
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = 0
        spin.toValue = CGFloat.pi * 2
        spin.duration = 1.8
        spin.repeatCount = .infinity
        searchLogo.layer.add(spin, forKey: "spin")
    }

    private func stopSearchSpinner(hideLogo: Bool = true) {
        searchLogo.layer.removeAnimation(forKey: "spin")
        searchLogo.transform = .identity
        if hideLogo { searchLogo.isHidden = true }
    }

    /// 1:1 with Android: system Wi‑Fi prompt for AuraHomeSystems_Setup, then in-app form.
    private func startSoftApSetup() {
        if finishedOk || softApMode || peripheral != nil { return }
        softApMode = true
        stopLookingTick()
        if central.state == .poweredOn { central.stopScan() }
        stopSearchSpinner(hideLogo: false)
        // Drop any copy of the setup network this app saved in older builds.
        clearStaleSetupConfigs {}
        showSoftApGuide()
        requestSoftApNetwork(attempt: 1)
    }

    /// iOS refuses the automatic join on many iPhones ("Unable to join", error 11), so the
    /// customer taps the sensor network once in Settings. The app continues by itself.
    private func showSoftApGuide(note: String = "") {
        headline.text = "Connect to the sensor"
        detail.text = note + "1. Open Settings → Wi-Fi\n2. Tap AuraHomeSystems_Setup\n3. Come back to Aura. It continues by itself."
        form.isHidden = true
        connectButton.isHidden = false
        setSetupControlsEnabled(true)
        connectButton.setTitle("I'm connected", for: .normal)
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(retrySoftApSetup), for: .touchUpInside)
        startSoftApPolling()
    }

    private func startSoftApPolling() {
        softApPollTimer?.invalidate()
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            guard let self = self, self.softApMode, !self.softApReady, !self.finishedOk else { return }
            DispatchQueue.global(qos: .userInitiated).async {
                if self.pingSoftAp(timeout: 1.5) {
                    DispatchQueue.main.async {
                        if !self.softApReady && !self.finishedOk { self.onSoftApNetworkAvailable() }
                    }
                }
            }
        }
        softApPollTimer = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    /// While Waiting / linking — lock Close, fields, Refresh, Connect.
    private func setSetupControlsEnabled(_ enabled: Bool) {
        closeButton.isEnabled = enabled
        closeButton.alpha = enabled ? 1 : 0.35
        ssidField.isEnabled = enabled
        passField.isEnabled = enabled
        nameField.isEnabled = enabled
        refreshNetworksButton.isEnabled = enabled
        refreshNetworksButton.alpha = enabled ? 1 : 0.35
        networks.isUserInteractionEnabled = enabled
        connectButton.isEnabled = enabled
        connectButton.alpha = 1
        passField.alpha = 1
        nameField.alpha = 1
        if !enabled {
            view.endEditing(true)
        } else {
            // Step by step: network, then password, then name and Connect.
            updateFormState()
        }
    }

    /// Back from Settings after joining the sensor Wi-Fi by hand: continue automatically.
    @objc private func appBecameActive() {
        guard softApMode, !softApReady, !finishedOk else { return }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if self.pingSoftAp(timeout: 2) {
                DispatchQueue.main.async {
                    if !self.softApReady && !self.finishedOk { self.onSoftApNetworkAvailable() }
                }
            }
        }
    }

    @objc private func retrySoftApSetup() {
        softApGuideNote = "Not connected to the sensor yet.\n\n"
        softApMode = false
        softApReady = false
        startSoftApSetup()
    }

    private func requestSoftApNetwork(attempt: Int) {
        // Already on the sensor Wi-Fi? Go straight on, otherwise keep showing the guide.
        let note = softApGuideNote
        softApGuideNote = ""
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if self.pingSoftAp() {
                DispatchQueue.main.async { self.onSoftApNetworkAvailable() }
                return
            }
            if !note.isEmpty {
                DispatchQueue.main.async { self.showSoftApGuide(note: note) }
            }
        }
    }

    /// Remove every Aura setup network this app saved earlier (old builds left saved
    /// copies with other settings; iOS then fails the join with "Unable to join").
    private func clearStaleSetupConfigs(_ done: @escaping () -> Void) {
        NEHotspotConfigurationManager.shared.getConfiguredSSIDs { ssids in
            var names = Set(ssids.filter { $0.hasPrefix("AuraHomeSystems") })
            names.insert(self.setupApSsid)
            for name in names {
                NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: name)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { done() }
        }
    }

    private func onSoftApNetworkAvailable() {
        softApPollTimer?.invalidate()
        softApPollTimer = nil
        softApReady = true
        headline.text = "Home Wi-Fi"
        detail.text = "Linked to the sensor. Loading Wi-Fi list…"
        form.isHidden = false
        connectButton.isHidden = false
        setSetupControlsEnabled(true)
        refreshNetworksButton.isHidden = false
        // Connect stays off while the sensor's Wi-Fi networks are being loaded.
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
        networksReady = false
        updateFormState()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.waitForPingThenFetchWifi()
        }
    }

    private func waitForPingThenFetchWifi() {
        for _ in 0..<40 {
            if finishedOk { return }
            if pingSoftAp() { break }
            Thread.sleep(forTimeInterval: 0.5)
        }
        fetchWifiList(retries: 5)
    }

    private func pingSoftAp(timeout: TimeInterval = 3) -> Bool {
        var request = URLRequest(url: pingUrl)
        request.httpMethod = "GET"
        request.timeoutInterval = timeout
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        softApSession.dataTask(with: request) { data, response, _ in
            defer { sem.signal() }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data ?? Data(), encoding: .utf8) ?? ""
            ok = code == 200 && body.contains("aura")
        }.resume()
        _ = sem.wait(timeout: .now() + timeout + 0.4)
        return ok
    }

    /// Sensor /wifi does a full scan — can take ~20–30s; retry when SoftAP routing is flaky.
    private func fetchWifiList(retries: Int) {
        var lastSsids: [String] = []
        var lastFailed = true
        for attempt in 1...max(1, retries) {
            if finishedOk { return }
            let result = requestWifiListOnce()
            lastFailed = result.failed
            lastSsids = result.ssids
            if !result.failed && !result.ssids.isEmpty { break }
            if attempt < retries {
                Thread.sleep(forTimeInterval: 2.0)
            }
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.finishedOk else { return }
            self.refreshNetworksButton.isEnabled = true
            self.networksReady = true
            self.suggestFreeSensorName()
            self.updateFormState()
            if lastFailed {
                self.detail.text = "Wi-Fi list unavailable — type the name, then Connect. Or tap Refresh networks."
            } else {
                self.showWifiSuggestions(lastSsids)
                self.detail.text = lastSsids.isEmpty
                    ? "No networks found — type the Wi-Fi name, then Connect. Or tap Refresh networks."
                    : "Tap a network or type it, enter the password, then Connect."
            }
        }
    }

    private func requestWifiListOnce() -> (ssids: [String], failed: Bool) {
        var request = URLRequest(url: wifiUrl)
        request.httpMethod = "GET"
        request.timeoutInterval = 45
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let sem = DispatchSemaphore(value: 0)
        var ssids: [String] = []
        var failed = false
        softApSession.dataTask(with: request) { data, response, _ in
            defer { sem.signal() }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 200, let data = data,
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [Any] else {
                failed = true
                return
            }
            for item in arr {
                let ssid = (item as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if ssid.isEmpty || ssid == self.setupApSsid || ssids.contains(ssid) { continue }
                ssids.append(ssid)
            }
        }.resume()
        _ = sem.wait(timeout: .now() + 50)
        return (ssids, failed)
    }

    private func showWifiSuggestions(_ ssids: [String]) {
        networks.arrangedSubviews.forEach {
            networks.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        if ssids.isEmpty { return }
        for ssid in ssids {
            let pick = UIButton(type: .system)
            pick.setTitle(ssid, for: .normal)
            pick.setTitleColor(.white, for: .normal)
            pick.contentHorizontalAlignment = .leading
            pick.addAction(UIAction { [weak self] _ in
                self?.ssidField.text = ssid
                self?.updateFormState()
            }, for: .touchUpInside)
            networks.addArrangedSubview(pick)
        }
    }

    private func postSoftApCredentials(ssid: String, pass: String, name: String) {
        credsSent = true
        finishedOk = false
        connectingProgress = true
        lastProvisionedName = name
        dismissKeyboard()
        setSetupControlsEnabled(false)
        form.isHidden = true
        hideActionButton()
        hideReturnButton()
        searchLogo.isHidden = true
        shownPct = 0
        magnets.pct = 0
        percent.text = "0%"
        showProgress(35, title: "Connecting")
        detail.text = "Sending Wi-Fi to the sensor… This can take up to a minute."
        // Keep magnets approaching while SoftAP provision runs (same feel as Android).
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self = self, self.credsSent, !self.finishedOk else { return }
            self.hideReturnButton()
            self.showProgress(70, title: "Connecting")
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if !self.pingSoftAp() {
                DispatchQueue.main.async {
                    self.credsSent = false
                    self.form.isHidden = false
                    self.showConnectButton()
                    self.percent.isHidden = true
                    self.magnets.isHidden = true
                    self.searchLogo.isHidden = false
                    self.detail.text = "Could not reach the sensor. Restart it and try again."
                }
                return
            }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.credsSent, !self.finishedOk else { return }
                self.showProgress(85, title: "Connecting")
            }
            let body: [String: String] = [
                "ssid": ssid,
                "pass": pass,
                "email": self.email,
                "name": name,
                "clearRemoved": "1",
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
            var request = URLRequest(url: self.provUrl)
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
            request.httpBody = data
            let sem = DispatchSemaphore(value: 0)
            var code = 0
            self.softApSession.dataTask(with: request) { _, response, _ in
                code = (response as? HTTPURLResponse)?.statusCode ?? 0
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 95)
            DispatchQueue.main.async {
                if code >= 200 && code < 300 {
                    self.finishedOk = true
                    self.hideActionButton()
                    self.showProgress(100, title: "Connected")
                    self.detail.text = "Sensor is connected."
                    NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: self.setupApSsid)
                } else {
                    self.credsSent = false
                    self.form.isHidden = false
                    self.showConnectButton()
                    self.percent.isHidden = true
                    self.magnets.isHidden = true
                    self.searchLogo.isHidden = false
                    self.detail.text = "Send failed. Check the Wi-Fi password and try again."
                }
            }
        }
    }

    private func hideActionButton() {
        connectButton.isHidden = true
        connectButton.isEnabled = false
        connectButton.setTitle("Connect", for: .normal)
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
        hideReturnButton()
    }

    private func hideReturnButton() {
        returnButton.isHidden = true
        returnButton.isEnabled = false
    }

    private func showConnectButton() {
        connectingProgress = false
        hideReturnButton()
        connectButton.isHidden = false
        networksReady = true
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
        setSetupControlsEnabled(true)
    }

    private func showDashboardReturnButton() {
        // Never show while Connecting % is still running.
        guard finishedOk, !connectingProgress || shownPct >= 100 else { return }
        guard shownPct >= 100 else { return }
        connectingProgress = false
        connectButton.isHidden = true
        connectButton.isEnabled = false
        // No button: count 3, 2, 1 and go back to the dashboard by itself.
        hideReturnButton()
        closeButton.isEnabled = true
        closeButton.alpha = 1
        startReturnCountdown()
    }

    private func startReturnCountdown() {
        guard returnCountdown == nil else { return }
        var left = 3
        headline.text = "Connected"
        percent.text = "\(left)"
        detail.text = "Your sensor is ready. Taking you to the dashboard in \(left)…"
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            left -= 1
            if left <= 0 {
                timer.invalidate()
                self.returnCountdown = nil
                self.closeTapped()
                return
            }
            self.percent.text = "\(left)"
            self.detail.text = "Your sensor is ready. Taking you to the dashboard in \(left)…"
        }
        returnCountdown = timer
        RunLoop.main.add(timer, forMode: .common)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if softApMode || finishedOk { return }
        if central.state == .poweredOn {
            looking = true
            startSearchSpinner()
            beginBleScanPass()
        } else if central.state == .poweredOff {
            // SoftAP path still works without Bluetooth.
            detail.text = "Please turn Bluetooth on to find the sensor."
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        if softApMode || finishedOk { return }
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name
        if name != "Aura Sensor" && name != "Aura" && advertisementData[CBAdvertisementDataServiceUUIDsKey] == nil {
            return
        }
        softApFallbackWork?.cancel()
        stopLookingTick()
        self.peripheral = peripheral
        peripheral.delegate = self
        central.stopScan()
        stopSearchSpinner()
        headline.text = "Sensor found"
        detail.text = "Connecting to the sensor."
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([service])
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if finishedOk || softApMode { return }
        if credsSent {
            detail.text = "The sensor disconnected. Stay next to it and try again."
            credsSent = false
        }
        self.peripheral = nil
        bleListReady = false
        looking = true
        lookingSince = Date()
        startLookingTick()
        startSearchSpinner()
        headline.text = "Looking for the sensor"
        if central.state == .poweredOn {
            beginBleScanPass()
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let found = peripheral.services?.first(where: { $0.uuid == service }) else { return }
        peripheral.discoverCharacteristics([listId, credId, statId], for: found)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for item in service.characteristics ?? [] {
            if item.uuid == statId {
                peripheral.setNotifyValue(true, for: item)
            }
            if item.uuid == listId {
                peripheral.readValue(for: item)
            }
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let text = String(data: characteristic.value ?? Data(), encoding: .utf8) ?? ""
        if characteristic.uuid == listId {
            showNetworks(text)
        } else if characteristic.uuid == statId {
            applyStatus(text)
        }
    }

    private func showNetworks(_ raw: String) {
        if credsSent { return }
        stopSearchSpinner(hideLogo: true)
        percent.isHidden = true
        magnets.isHidden = true
        form.isHidden = false
        connectButton.isHidden = false
        setSetupControlsEnabled(true)
        // Over Bluetooth the sensor scans once, so there is nothing to refresh.
        refreshNetworksButton.isHidden = true
        headline.text = "Home Wi-Fi"
        let hasNetworks = !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if !bleListReady && !hasNetworks {
            // The sensor is still scanning for Wi-Fi networks: Connect stays off until it is done.
            detail.text = "Searching for Wi-Fi networks…"
            networksReady = false
            updateFormState()
            return
        }
        networksReady = true
        suggestFreeSensorName()
        detail.text = "1. Choose your home Wi-Fi  2. Enter its password  3. Name the sensor"
        networks.arrangedSubviews.forEach {
            networks.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        for part in raw.split(separator: "\n") {
            let ssid = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
            if ssid.isEmpty { continue }
            let pick = UIButton(type: .system)
            pick.setTitle(ssid, for: .normal)
            pick.setTitleColor(.white, for: .normal)
            pick.contentHorizontalAlignment = .leading
            pick.addAction(UIAction { [weak self] _ in
                self?.ssidField.text = ssid
                self?.updateFormState()
            }, for: .touchUpInside)
            networks.addArrangedSubview(pick)
        }
        updateFormState()
    }

    @objc private func sendCredentials() {
        dismissKeyboard()
        let ssid = (ssidField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pass = passField.text ?? ""
        var name = (nameField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if ssid.isEmpty {
            detail.text = "Enter the Wi-Fi name."
            return
        }
        if name.isEmpty { name = "Front Door" }
        if existingSensorKeys.contains(Self.sensorKey(name)) {
            detail.text = "You already have a sensor named “\(name)”. Please choose a different name."
            return
        }
        if softApMode {
            postSoftApCredentials(ssid: ssid, pass: pass, name: name)
            return
        }
        guard let peripheral = peripheral,
              let service = peripheral.services?.first(where: { $0.uuid == self.service }),
              let cred = service.characteristics?.first(where: { $0.uuid == credId }) else { return }
        let body: [String: String] = [
            "ssid": ssid,
            "pass": pass,
            "email": email,
            "name": name,
            "clearRemoved": "1",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        credsSent = true
        finishedOk = false
        connectingProgress = true
        lastProvisionedName = name
        form.isHidden = true
        hideActionButton()
        hideReturnButton()
        searchLogo.isHidden = true
        shownPct = 0
        magnets.pct = 0
        percent.text = "0%"
        showProgress(45, title: "Connecting")
        peripheral.writeValue(data, for: cred, type: .withResponse)
    }

    private func applyStatus(_ raw: String) {
        // Already counting down to the dashboard: ignore late status messages.
        if returnCountdown != nil { return }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = text.split(separator: " ", maxSplits: 1).map(String.init)
        let pct = Int(parts.first ?? "") ?? 0
        let stage = parts.count > 1 ? parts[1] : text
        if stage == "found" {
            // The sensor has scanned the home networks: read the list again.
            bleListReady = true
            if let service = peripheral?.services?.first(where: { $0.uuid == self.service }),
               let list = service.characteristics?.first(where: { $0.uuid == listId }) {
                peripheral?.readValue(for: list)
            }
            return
        }
        if stage == "badwifi" {
            credsSent = false
            shownPct = 0
            targetPct = 0
            magnetTimer?.invalidate()
            form.isHidden = false
            showConnectButton()
            percent.isHidden = true
            magnets.isHidden = true
            headline.text = "Home Wi-Fi"
            detail.text = "The Wi-Fi name or password was not accepted."
            return
        }
        if stage == "bademail" {
            credsSent = false
            shownPct = 0
            targetPct = 0
            magnetTimer?.invalidate()
            form.isHidden = false
            showConnectButton()
            percent.isHidden = true
            magnets.isHidden = true
            headline.text = "Home Wi-Fi"
            detail.text = "That email does not have an Aura account."
            return
        }
        if stage == "ok" || pct >= 100 {
            finishedOk = true
            hideActionButton()
            showProgress(100, title: "Connected")
            detail.text = "Sensor is connected."
            return
        }
        if pct > 0 {
            hideActionButton()
            showProgress(pct, title: "Connecting")
        }
    }

    private func showProgress(_ pct: Int, title: String) {
        stopSearchSpinner(hideLogo: true)
        searchLogo.isHidden = true
        // Always hide both action buttons while % < 100.
        hideActionButton()
        hideReturnButton()
        if pct < 100 {
            connectingProgress = true
        }
        percent.isHidden = false
        magnets.isHidden = false
        magnets.setNeedsDisplay()
        headline.text = title
        percent.text = "\(shownPct)%"
        magnets.pct = shownPct
        targetPct = min(100, max(0, pct))
        magnetTimer?.invalidate()
        let timer = Timer(timeInterval: 0.028, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if self.shownPct >= self.targetPct {
                timer.invalidate()
                if self.finishedOk && self.shownPct >= 100 && self.targetPct >= 100 {
                    self.connectingProgress = false
                    self.showDashboardReturnButton()
                }
                return
            }
            self.shownPct += 1
            self.magnets.pct = self.shownPct
            self.percent.text = "\(self.shownPct)%"
            self.percent.textColor = Self.blend(
                from: UIColor(red: 0.99, green: 0.65, blue: 0.65, alpha: 1),
                to: UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1),
                t: CGFloat(self.shownPct) / 100
            )
            // Keep return hidden for the whole animation.
            self.hideReturnButton()
            if self.finishedOk && self.shownPct >= 100 && self.targetPct >= 100 {
                timer.invalidate()
                self.connectingProgress = false
                self.showDashboardReturnButton()
            }
        }
        magnetTimer = timer
        RunLoop.main.add(timer, forMode: .common)
        if finishedOk && shownPct >= 100 && targetPct >= 100 {
            connectingProgress = false
            showDashboardReturnButton()
        }
    }

    private static func blend(from: UIColor, to: UIColor, t: CGFloat) -> UIColor {
        var fr: CGFloat = 0, fg: CGFloat = 0, fb: CGFloat = 0, fa: CGFloat = 0
        var tr: CGFloat = 0, tg: CGFloat = 0, tb: CGFloat = 0, ta: CGFloat = 0
        from.getRed(&fr, green: &fg, blue: &fb, alpha: &fa)
        to.getRed(&tr, green: &tg, blue: &tb, alpha: &ta)
        let c = min(1, max(0, t))
        return UIColor(red: fr + (tr - fr) * c, green: fg + (tg - fg) * c, blue: fb + (tb - fb) * c, alpha: 1)
    }

    @objc private func closeTapped() {
        softApFallbackWork?.cancel()
        softApPollTimer?.invalidate()
        softApPollTimer = nil
        returnCountdown?.invalidate()
        returnCountdown = nil
        stopLookingTick()
        if central.state == .poweredOn { central.stopScan() }
        if let peripheral = peripheral { central.cancelPeripheralConnection(peripheral) }
        let done = onClose
        onClose = nil
        let paired = finishedOk
        let name = lastProvisionedName
        // Do not leave the setup network saved on the phone.
        for saved in [setupApSsid] {
            NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: saved)
        }
        dismiss(animated: true) {
            done?(paired, name)
        }
    }

    private func caption(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.textColor = UIColor(white: 0.65, alpha: 1)
        label.font = .systemFont(ofSize: 13)
        label.numberOfLines = 0
        return label
    }

    private func style(_ field: UITextField, placeholder: String) {
        field.placeholder = placeholder
        field.textColor = .white
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(white: 0.45, alpha: 1)]
        )
        field.backgroundColor = UIColor(red: 0.01, green: 0.02, blue: 0.09, alpha: 1)
        field.layer.cornerRadius = 12
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 0.25, alpha: 1).cgColor
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 8))
        field.leftViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 44).isActive = true
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.keyboardAppearance = .dark
    }
}

final class MagnetMark: UIView {
    var pct: Int = 0 { didSet { setNeedsDisplay() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isOpaque = false
        contentMode = .redraw
    }

    required init?(coder: NSCoder) { return nil }

    override func draw(_ rect: CGRect) {
        let t = CGFloat(min(100, max(0, pct))) / 100
        let cx = rect.midX
        let cy = rect.midY
        let radius = min(rect.width, rect.height) * 0.36
        let color = Self.mix(UIColor(red: 0.94, green: 0.27, blue: 0.27, alpha: 1), UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1), t)
        let ring = UIBezierPath(arcCenter: CGPoint(x: cx, y: cy), radius: radius, startAngle: 210 * .pi / 180, endAngle: (210 + 360 - 90 * (1 - t)) * .pi / 180, clockwise: true)
        ring.lineWidth = radius * 0.18
        ring.lineCapStyle = .round
        color.setStroke()
        ring.stroke()
        let magW = radius * 0.78
        let magH = radius * 0.24
        let gap = radius * (0.46 - 0.38 * t)
        let top = cy - gap / 2 - magH
        let bottom = cy + gap / 2
        Self.magnet(CGRect(x: cx - magW / 2, y: top, width: magW, height: magH))
        Self.magnet(CGRect(x: cx - magW / 2, y: bottom, width: magW, height: magH))
        if t < 0.98 {
            let beam = UIBezierPath(roundedRect: CGRect(x: cx - radius * 0.035, y: cy - gap / 2, width: radius * 0.07, height: gap), cornerRadius: 2)
            color.setFill()
            beam.fill()
        }
    }

    private static func magnet(_ rect: CGRect) {
        let path = UIBezierPath(roundedRect: rect, cornerRadius: rect.height / 2)
        let colors = [UIColor.white.cgColor, UIColor(red: 0.39, green: 0.45, blue: 0.55, alpha: 1).cgColor] as CFArray
        let space = CGColorSpaceCreateDeviceRGB()
        if let gradient = CGGradient(colorsSpace: space, colors: colors, locations: [0, 1]),
           let ctx = UIGraphicsGetCurrentContext() {
            ctx.saveGState()
            path.addClip()
            ctx.drawLinearGradient(gradient, start: CGPoint(x: rect.midX, y: rect.minY), end: CGPoint(x: rect.midX, y: rect.maxY), options: [])
            ctx.restoreGState()
        }
    }

    private static func mix(_ from: UIColor, _ to: UIColor, _ t: CGFloat) -> UIColor {
        var fr: CGFloat = 0, fg: CGFloat = 0, fb: CGFloat = 0, fa: CGFloat = 0
        var tr: CGFloat = 0, tg: CGFloat = 0, tb: CGFloat = 0, ta: CGFloat = 0
        from.getRed(&fr, green: &fg, blue: &fb, alpha: &fa)
        to.getRed(&tr, green: &tg, blue: &tb, alpha: &ta)
        return UIColor(red: fr + (tr - fr) * t, green: fg + (tg - fg) * t, blue: fb + (tb - fb) * t, alpha: 1)
    }
}
