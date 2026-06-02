import Combine
import Foundation

// RaceTemplatesStore — single source of truth on the Watch for the
// user's saved HYROX race templates. Mirrors TodaySnapshotStore's
// design: phone-pushed via `WCSession.updateApplicationContext`,
// persisted to UserDefaults so the templates survive cold launches and
// are available even when the phone isn't paired.
//
// There's no Watch-driven HTTP fetch path for templates — the phone
// owns the truth and re-pushes after every list refresh / mutation. If
// the user saves a new template on the phone and immediately picks up
// their watch, they'll see the new entry within seconds.

@MainActor
final class RaceTemplatesStore: ObservableObject {
    static let shared = RaceTemplatesStore()

    @Published private(set) var templates: [SavedRaceTemplate] = []
    @Published private(set) var lastUpdatedAt: Date?

    private let defaults = UserDefaults.standard
    private static let templatesKey = "watch.raceTemplates.v1"
    private static let updatedAtKey = "watch.raceTemplates.lastUpdatedAt.v1"
    private static let generatedAtKey = "watch.raceTemplates.generatedAt.v1"

    /// Generation timestamp of the currently held snapshot. Used to
    /// resolve out-of-order pushes (rare, but the WCSession order
    /// guarantees are weak across transport modes).
    private var generatedAt: Int = 0

    private init() {
        loadFromUserDefaults()
    }

    /// Called by WatchConnectivityManager when the phone pushes a
    /// fresh templates snapshot via `updateApplicationContext`.
    func ingestFromApplicationContext(_ json: String) {
        guard let data = json.data(using: .utf8) else { return }
        guard let snapshot = try? JSONDecoder().decode(RaceTemplatesSnapshot.self, from: data)
        else {
            print("[RaceTemplatesStore] failed to decode phone-pushed snapshot")
            return
        }
        // Out-of-order guard — never overwrite a fresher snapshot.
        if snapshot.generatedAt < generatedAt {
            return
        }
        templates = snapshot.templates
        generatedAt = snapshot.generatedAt
        lastUpdatedAt = Date()
        persist()
    }

    private func persist() {
        do {
            let data = try JSONEncoder().encode(templates)
            defaults.set(data, forKey: Self.templatesKey)
            defaults.set(generatedAt, forKey: Self.generatedAtKey)
            if let lastUpdatedAt {
                defaults.set(
                    lastUpdatedAt.timeIntervalSince1970,
                    forKey: Self.updatedAtKey
                )
            }
        } catch {
            print("[RaceTemplatesStore] persist failed: \(error)")
        }
    }

    private func loadFromUserDefaults() {
        if let data = defaults.data(forKey: Self.templatesKey),
           let cached = try? JSONDecoder().decode([SavedRaceTemplate].self, from: data) {
            templates = cached
        }
        generatedAt = defaults.integer(forKey: Self.generatedAtKey)
        let raw = defaults.double(forKey: Self.updatedAtKey)
        if raw > 0 {
            lastUpdatedAt = Date(timeIntervalSince1970: raw)
        }
    }

    /// Drop the cached list on sign-out so a future session on a
    /// different account doesn't inherit the previous user's templates.
    func clear() {
        templates = []
        lastUpdatedAt = nil
        generatedAt = 0
        defaults.removeObject(forKey: Self.templatesKey)
        defaults.removeObject(forKey: Self.updatedAtKey)
        defaults.removeObject(forKey: Self.generatedAtKey)
    }

    /// Lookup by id — used after a user picks a template and the timer
    /// is about to start, so the picker doesn't need to hold a copy of
    /// the segments in @State.
    func template(id: String) -> SavedRaceTemplate? {
        templates.first { $0.id == id }
    }
}
