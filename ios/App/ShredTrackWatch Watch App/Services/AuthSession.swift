import Combine
import Foundation

// AuthSession — the Watch-side cached session.
//
// The phone is the source of truth (native-app spec §4.2 step 3). The
// Watch holds whatever access token the phone last pushed via
// `WCSession.updateApplicationContext` and stores it in the Keychain so
// it survives app termination, reboots, and battery death.
//
// In v1 the Watch never refreshes a token itself — `transferUserInfo`
// is just a queued message to the phone, which is the one that
// authenticates the eventual API call (native-app spec §5.4). So a
// stale Watch token is harmless: the phone will refresh on its end.

@MainActor
final class AuthSession: ObservableObject {
    static let shared = AuthSession()

    @Published private(set) var accessToken: String?
    @Published private(set) var userId: String?
    @Published private(set) var expiresAt: Date?

    private let keychain = KeychainStore(service: "net.shredstack.shredtrack.watch")

    private init() {}

    var isSignedIn: Bool {
        accessToken != nil && userId != nil
    }

    func loadFromKeychain() {
        accessToken = keychain.read(key: "accessToken")
        userId = keychain.read(key: "userId")
        if let raw = keychain.read(key: "expiresAt"), let secs = TimeInterval(raw) {
            expiresAt = Date(timeIntervalSince1970: secs)
        }
    }

    func updateFromPhone(accessToken: String, userId: String, expiresAt: Date?) {
        self.accessToken = accessToken
        self.userId = userId
        self.expiresAt = expiresAt
        keychain.write(key: "accessToken", value: accessToken)
        keychain.write(key: "userId", value: userId)
        if let expiresAt {
            keychain.write(key: "expiresAt", value: String(expiresAt.timeIntervalSince1970))
        }
    }

    func clear() {
        accessToken = nil
        userId = nil
        expiresAt = nil
        keychain.delete(key: "accessToken")
        keychain.delete(key: "userId")
        keychain.delete(key: "expiresAt")
    }
}
