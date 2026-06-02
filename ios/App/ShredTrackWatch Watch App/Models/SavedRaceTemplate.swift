import Foundation

// SavedRaceTemplate — a user-saved HYROX race configuration mirrored
// from the phone. The Watch never writes to this model; it's a
// read-only snapshot pushed via WCSession.updateApplicationContext from
// the phone after a successful read of /api/hyrox/race-templates.
//
// The segment shape matches the on-watch RaceSegment so the picker can
// hand them straight to the race timer without a separate mapping
// layer.

struct SavedRaceTemplate: Codable, Identifiable, Sendable {
    let id: String
    let name: String
    let divisionKey: String?
    let simulateRoxzone: Bool
    let segments: [RaceSegment]
}

/// Envelope used by the phone push — wraps the templates array with a
/// generation timestamp so the store can prefer the freshest copy when
/// two ingest paths race.
struct RaceTemplatesSnapshot: Codable {
    let generatedAt: Int
    let templates: [SavedRaceTemplate]
}
