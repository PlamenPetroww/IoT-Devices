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

final class AuraSetupController: UIViewController, CBCentralManagerDelegate, CBPeripheralDelegate {
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
    private let connectButton = UIButton(type: .system)

    init(email: String) {
        self.email = email
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        return nil
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.09, blue: 0.16, alpha: 1)
        headline.textColor = .white
        headline.font = .systemFont(ofSize: 24, weight: .medium)
        headline.textAlignment = .center
        headline.numberOfLines = 0
        detail.textColor = UIColor(white: 0.8, alpha: 1)
        detail.font = .systemFont(ofSize: 15)
        detail.textAlignment = .center
        detail.numberOfLines = 0
        percent.textColor = UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1)
        percent.font = .systemFont(ofSize: 52, weight: .medium)
        percent.textAlignment = .center
        percent.isHidden = true
        searchLogo.image = UIImage(named: "AuraMark")
        searchLogo.contentMode = .scaleAspectFit
        searchLogo.clipsToBounds = true
        searchLogo.layer.cornerRadius = 20
        searchLogo.backgroundColor = UIColor(white: 1, alpha: 0.06)
        searchLogo.translatesAutoresizingMaskIntoConstraints = false
        searchLogo.widthAnchor.constraint(equalToConstant: 112).isActive = true
        searchLogo.heightAnchor.constraint(equalToConstant: 112).isActive = true
        magnets.isHidden = true
        magnets.translatesAutoresizingMaskIntoConstraints = false
        magnets.heightAnchor.constraint(equalToConstant: 168).isActive = true
        form.axis = .vertical
        form.spacing = 8
        form.isHidden = true
        networks.axis = .vertical
        style(ssidField, placeholder: "Wi-Fi name")
        style(passField, placeholder: "Password")
        passField.isSecureTextEntry = true
        style(nameField, placeholder: "Front Door")
        nameField.text = "Front Door"
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

        let stack = UIStackView(arrangedSubviews: [close, searchLogo, percent, headline, detail, magnets, form, connectButton])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 16)
        ])
        form.addArrangedSubview(caption("Network"))
        form.addArrangedSubview(ssidField)
        form.addArrangedSubview(networks)
        form.addArrangedSubview(caption("Password"))
        form.addArrangedSubview(passField)
        form.addArrangedSubview(caption("Sensor name"))
        form.addArrangedSubview(nameField)
        form.addArrangedSubview(caption("Choose the 2.4 GHz network."))
        headline.text = "Looking for the sensor"
        detail.text = "Restart the sensor and stay next to it. Everything stays in the app."
        startSearchSpinner()
        central = CBCentralManager(delegate: self, queue: nil)
        // Board opens SoftAP after ~8s BLE; join in-app like Android.
        let work = DispatchWorkItem { [weak self] in self?.startSoftApSetup() }
        softApFallbackWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 10, execute: work)
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

    private func stopSearchSpinner() {
        searchLogo.layer.removeAnimation(forKey: "spin")
        searchLogo.isHidden = true
        searchLogo.transform = .identity
    }

    private func startSoftApSetup() {
        if finishedOk || softApMode || peripheral != nil { return }
        softApMode = true
        if central.state == .poweredOn { central.stopScan() }
        stopSearchSpinner()
        headline.text = "Sensor Wi-Fi"
        detail.text = "Connecting to AuraHomeSystems_Setup…"
        connectButton.isHidden = false
        connectButton.isEnabled = false
        connectButton.setTitle("Connecting…", for: .normal)

        let config = NEHotspotConfiguration(ssid: setupApSsid)
        config.joinOnce = true
        NEHotspotConfigurationManager.shared.apply(config) { [weak self] error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let error = error as NSError? {
                    // Already connected is OK (code 13 / NEHotspotConfigurationError.alreadyAssociated).
                    if error.domain == NEHotspotConfigurationErrorDomain,
                       error.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
                        self.onSoftApJoined()
                        return
                    }
                    self.detail.text = "Could not join sensor Wi-Fi. Confirm the Wi-Fi prompt, restart the sensor, and try again."
                    self.connectButton.isEnabled = true
                    self.connectButton.setTitle("Try again", for: .normal)
                    self.connectButton.removeTarget(nil, action: nil, for: .allEvents)
                    self.connectButton.addTarget(self, action: #selector(self.retrySoftAp), for: .touchUpInside)
                    return
                }
                self.onSoftApJoined()
            }
        }
    }

    @objc private func retrySoftAp() {
        softApMode = false
        softApReady = false
        startSoftApSetup()
    }

    private func onSoftApJoined() {
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
        fetchWifiList()
    }

    private func pingSoftAp() -> Bool {
        var request = URLRequest(url: pingUrl)
        request.httpMethod = "GET"
        request.timeoutInterval = 2
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { data, response, _ in
            defer { sem.signal() }
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let body = String(data: data ?? Data(), encoding: .utf8) ?? ""
            ok = code == 200 && body.contains("aura")
        }.resume()
        _ = sem.wait(timeout: .now() + 3)
        return ok
    }

    private func fetchWifiList() {
        var request = URLRequest(url: wifiUrl)
        request.httpMethod = "GET"
        request.timeoutInterval = 25
        let sem = DispatchSemaphore(value: 0)
        var ssids: [String] = []
        var failed = false
        URLSession.shared.dataTask(with: request) { data, response, _ in
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
        _ = sem.wait(timeout: .now() + 30)
        DispatchQueue.main.async { [weak self] in
            guard let self = self, !self.finishedOk else { return }
            if failed {
                self.detail.text = "Wi-Fi list unavailable — type the name, then Connect."
            } else {
                self.showWifiSuggestions(ssids)
                self.detail.text = ssids.isEmpty
                    ? "No networks found — type the Wi-Fi name, then Connect."
                    : "Tap a network or type it, enter the password, then Connect."
            }
        }
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
        form.isHidden = true
        connectButton.isHidden = true
        showProgress(40, title: "Connecting")
        detail.text = "Sending Wi-Fi to the sensor… This can take up to a minute."
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
                    self.detail.text = "Could not reach the sensor. Restart it and try again."
                }
                return
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
            URLSession.shared.dataTask(with: request) { _, response, _ in
                code = (response as? HTTPURLResponse)?.statusCode ?? 0
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 95)
            DispatchQueue.main.async {
                if code >= 200 && code < 300 {
                    self.finishedOk = true
                    self.showProgress(100, title: "Done")
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
        stopSearchSpinner()
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
        stopSearchSpinner()
        percent.isHidden = false
        magnets.isHidden = false
        headline.text = title
        targetPct = min(100, max(0, pct))
        magnetTimer?.invalidate()
        magnetTimer = Timer.scheduledTimer(withTimeInterval: 0.028, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if self.shownPct >= self.targetPct {
                timer.invalidate()
                return
            }
            self.shownPct += 1
            self.magnets.pct = self.shownPct
            self.percent.text = "\(self.shownPct)%"
            self.percent.textColor = Self.blend(from: UIColor(red: 0.99, green: 0.65, blue: 0.65, alpha: 1), to: UIColor(red: 0.29, green: 0.87, blue: 0.5, alpha: 1), t: CGFloat(self.shownPct) / 100)
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
        field.backgroundColor = UIColor(red: 0.01, green: 0.02, blue: 0.09, alpha: 1)
        field.layer.cornerRadius = 12
        field.layer.borderWidth = 1
        field.layer.borderColor = UIColor(white: 0.25, alpha: 1).cgColor
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 8))
        field.leftViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 44).isActive = true
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
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
