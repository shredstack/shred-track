import UIKit
import Capacitor

// In-app custom Capacitor plugins (HealthKitTimer, WatchBridge) aren't auto-registered in Capacitor 8 — only npm-installed plugins listed in capacitor.config.json's packageClassList are. This subclass exists to register them programmatically once the bridge has loaded.

class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitTimer())
        bridge?.registerPluginInstance(WatchBridge())
    }
}
