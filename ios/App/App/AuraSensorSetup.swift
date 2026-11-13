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
            setup.modalPresentationStyle = .fullScreen
            presenter.present(setup, animated: true)
            call.resolve()
        }
    }
}

final class AuraSetupController: UIViewController, CBCentralManagerDelegate, CBPeripheralDelegate, UITextFieldDelegate {
    private let setupApSsid = "AuraHomeSystems_Setup"
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
    private var scrollBottomConstraint: NSLayoutConstraint?

    init(email: String) {
        self.email = email
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        return nil
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        magnetTimer?.invalidate()
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

        let close = UIButton(type: .system)
        close.setTitle("Close", for: .normal)
        close.setTitleColor(UIColor(white: 0.7, alpha: 1), for: .normal)
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.alwaysBounceVertical = true
        scrollView.keyboardDismissMode = .interactive
        scrollView.backgroundColor = pageBg
        view.addSubview(scrollView)

        let stack = UIStackView(arrangedSubviews: [brand, searchLogo, percent, headline, detail, magnets, form, connectButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(stack)

        let bottom = scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        scrollBottomConstraint = bottom
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            scrollView.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 8),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottom,
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -20),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -28),
            form.widthAnchor.constraint(equalTo: stack.widthAnchor),
            connectButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
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

        headline.text = "Looking for the sensor"
        detail.text = "Turn the sensor on and stay next to it for about a minute."
        startSearchSpinner()
        central = CBCentralManager(delegate: self, queue: nil)
        // Same timing as Android: SoftAP after ~8s on board → app joins ~10s.
        let work = DispatchWorkItem { [weak self] in self?.startSoftApSetup() }
        softApFallbackWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
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
        if central.state == .poweredOn { central.stopScan() }
        stopSearchSpinner(hideLogo: false)
        headline.text = "Sensor Wi-Fi"
        detail.text = "Confirm the Wi-Fi connection to the sensor (AuraHomeSystems_Setup)."
        form.isHidden = false
        connectButton.isHidden = false
        connectButton.isEnabled = false
        connectButton.setTitle("Waiting…", for: .normal)
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
        requestSoftApNetwork(attempt: 1)
    }

    @objc private func retrySoftApSetup() {
        softApMode = false
        softApReady = false
        startSoftApSetup()
    }

    private func requestSoftApNetwork(attempt: Int) {
        let config = NEHotspotConfiguration(ssid: setupApSsid)
        config.joinOnce = true
        NEHotspotConfigurationManager.shared.apply(config) { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self, !self.finishedOk else { return }
                if let error = error as NSError? {
                    if error.domain == NEHotspotConfigurationErrorDomain,
                       error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
                        self.onSoftApNetworkAvailable()
                        return
                    }
                    if attempt < 5 {
                        self.detail.text = "Confirm the Wi-Fi connection to the sensor (AuraHomeSystems_Setup)."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                            self?.requestSoftApNetwork(attempt: attempt + 1)
                        }
                        return
                    }
                    self.detail.text = "Sensor Wi-Fi not confirmed. Restart the sensor and try again."
                    self.connectButton.isEnabled = true
                    self.connectButton.setTitle("Try again", for: .normal)
                    self.connectButton.removeTarget(nil, action: nil, for: .allEvents)
                    self.connectButton.addTarget(self, action: #selector(self.retrySoftApSetup), for: .touchUpInside)
                    return
                }
                self.onSoftApNetworkAvailable()
            }
        }
    }

    private func onSoftApNetworkAvailable() {
        softApReady = true
        headline.text = "Home Wi-Fi"
        detail.text = "Linked to the sensor. Loading Wi-Fi list…"
        form.isHidden = false
        connectButton.isHidden = false
        connectButton.isEnabled = true
        connectButton.setTitle("Connect", for: .normal)
        connectButton.removeTarget(nil, action: nil, for: .allEvents)
        connectButton.addTarget(self, action: #selector(sendCredentials), for: .touchUpInside)
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

    private func pingSoftAp() -> Bool {
        var request = URLRequest(url: pingUrl)
        request.httpMethod = "GET"
        request.timeoutInterval = 3
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        softApSession.dataTask(with: request) { data, response, _ in
            defer { sem.signal() }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data ?? Data(), encoding: .utf8) ?? ""
            ok = code == 200 && body.contains("aura")
        }.resume()
        _ = sem.wait(timeout: .now() + 4)
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
        if (ssidField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ssidField.text = ssids[0]
        }
        for ssid in ssids {
            let pick = UIButton(type: .system)
            pick.setTitle(ssid, for: .normal)
            pick.setTitleColor(.white, for: .normal)
            pick.contentHorizontalAlignment = .leading
            pick.addAction(UIAction { [weak self] _ in self?.ssidField.text = ssid }, for: .touchUpInside)
            networks.addArrangedSubview(pick)
        }
    }

    private func postSoftApCredentials(ssid: String, pass: String, name: String) {
        credsSent = true
        dismissKeyboard()
        form.isHidden = true
        connectButton.isHidden = true
        searchLogo.isHidden = true
        shownPct = 0
        magnets.pct = 0
        showProgress(35, title: "Connecting")
        detail.text = "Sending Wi-Fi to the sensor… This can take up to a minute."
        // Keep magnets approaching while SoftAP provision runs (same feel as Android).
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self = self, self.credsSent, !self.finishedOk else { return }
            self.showProgress(70, title: "Connecting")
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if !self.pingSoftAp() {
                DispatchQueue.main.async {
                    self.credsSent = false
                    self.form.isHidden = false
                    self.connectButton.isHidden = false
                    self.connectButton.isEnabled = true
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
            let body: [String: String] = ["ssid": ssid, "pass": pass, "email": self.email, "name": name]
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
                    self.showProgress(100, title: "Connected")
                    self.detail.text = "Sensor is connected. Tap below to return to the dashboard."
                    self.connectButton.isHidden = false
                    self.connectButton.isEnabled = true
                    self.connectButton.setTitle("Back to dashboard", for: .normal)
                    self.connectButton.removeTarget(nil, action: nil, for: .allEvents)
                    self.connectButton.addTarget(self, action: #selector(self.closeTapped), for: .touchUpInside)
                    NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: self.setupApSsid)
                } else {
                    self.credsSent = false
                    self.form.isHidden = false
                    self.connectButton.isHidden = false
                    self.connectButton.isEnabled = true
                    self.percent.isHidden = true
                    self.magnets.isHidden = true
                    self.searchLogo.isHidden = false
                    self.detail.text = "Send failed. Check the Wi-Fi password and try again."
                }
            }
        }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if softApMode || finishedOk { return }
        if central.state == .poweredOn {
            startSearchSpinner()
            central.scanForPeripherals(withServices: [service], options: nil)
        } else if central.state == .poweredOff {
            // SoftAP path still works without Bluetooth.
            detail.text = "Bluetooth is off — joining sensor Wi-Fi shortly…"
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        if softApMode || finishedOk { return }
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name
        if name != "Aura Sensor" && name != "Aura" && advertisementData[CBAdvertisementDataServiceUUIDsKey] == nil {
            return
        }
        softApFallbackWork?.cancel()
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
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: [service], options: nil)
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
        form.isHidden = false
        connectButton.isHidden = false
        headline.text = "Home Wi-Fi"
        detail.text = "Enter the password and a name."
        networks.arrangedSubviews.forEach {
            networks.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        for part in raw.split(separator: "\n") {
            let ssid = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
            if ssid.isEmpty { continue }
            if (ssidField.text ?? "").isEmpty { ssidField.text = ssid }
            let pick = UIButton(type: .system)
            pick.setTitle(ssid, for: .normal)
            pick.setTitleColor(.white, for: .normal)
            pick.contentHorizontalAlignment = .leading
            pick.addAction(UIAction { [weak self] _ in self?.ssidField.text = ssid }, for: .touchUpInside)
            networks.addArrangedSubview(pick)
        }
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
        if softApMode {
            postSoftApCredentials(ssid: ssid, pass: pass, name: name)
            return
        }
        guard let peripheral = peripheral,
              let service = peripheral.services?.first(where: { $0.uuid == self.service }),
              let cred = service.characteristics?.first(where: { $0.uuid == credId }) else { return }
        let body: [String: String] = ["ssid": ssid, "pass": pass, "email": email, "name": name]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        credsSent = true
        form.isHidden = true
        connectButton.isHidden = true
        searchLogo.isHidden = true
        shownPct = 0
        magnets.pct = 0
        showProgress(45, title: "Connecting")
        peripheral.writeValue(data, for: cred, type: .withResponse)
    }

    private func applyStatus(_ raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = text.split(separator: " ", maxSplits: 1).map(String.init)
        let pct = Int(parts.first ?? "") ?? 0
        let stage = parts.count > 1 ? parts[1] : text
        if stage == "badwifi" {
            credsSent = false
            shownPct = 0
            targetPct = 0
            magnetTimer?.invalidate()
            form.isHidden = false
            connectButton.isHidden = false
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
            connectButton.isHidden = false
            percent.isHidden = true
            magnets.isHidden = true
            headline.text = "Home Wi-Fi"
            detail.text = "That email does not have an Aura account."
            return
        }
        if stage == "ok" || pct >= 100 {
            finishedOk = true
            showProgress(100, title: "Connected")
            detail.text = "Sensor is connected. Tap below to return to the dashboard."
            connectButton.isHidden = false
            connectButton.isEnabled = true
            connectButton.setTitle("Back to dashboard", for: .normal)
            connectButton.removeTarget(nil, action: nil, for: .allEvents)
            connectButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
            return
        }
        if pct > 0 { showProgress(pct, title: "Connecting") }
    }

    private func showProgress(_ pct: Int, title: String) {
        stopSearchSpinner(hideLogo: true)
        searchLogo.isHidden = true
        percent.isHidden = false
        magnets.isHidden = false
        magnets.setNeedsDisplay()
        headline.text = title
        targetPct = min(100, max(0, pct))
        magnetTimer?.invalidate()
        let timer = Timer(timeInterval: 0.028, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if self.shownPct >= self.targetPct {
                timer.invalidate()
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
        }
        magnetTimer = timer
        RunLoop.main.add(timer, forMode: .common)
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
        if central.state == .poweredOn { central.stopScan() }
        if let peripheral = peripheral { central.cancelPeripheralConnection(peripheral) }
        dismiss(animated: true)
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
