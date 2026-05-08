import Foundation

// MARK: - RaceSegmentFactory
//
// Builds the default segment list for the standard adult HYROX
// formats. Mirrors the TS factory in
// `src/components/hyrox/race-timer/race-segments.ts` for the divisions
// that ship with the v1 Watch app.
//
// Why a Swift mirror rather than a server fetch: the Watch must be able
// to set up a race with no network. v1 covers the four mainline adult
// divisions; youngstars + custom-segment editing happen on the
// phone/web for now and the Watch displays whatever segments the
// resulting race state contains (segments are part of `RaceState`).

public enum RaceTemplate: String, Codable, Sendable {
    case full
    case half
}

public enum RaceSegmentFactory {

    /// 8 standard HYROX stations in spec order. Weights vary by
    /// division — the Watch v1 ships only the women_open / men_open /
    /// women_pro / men_pro variants since those cover ~99% of users.
    private static let stationOrder: [String] = [
        "SkiErg",
        "Sled Push",
        "Sled Pull",
        "Burpee Broad Jumps",
        "Rowing",
        "Farmers Carry",
        "Sandbag Lunges",
        "Wall Balls",
    ]

    public static func buildFullRace(divisionKey: String) -> [RaceSegment] {
        let runDistanceM = 1000  // adult divisions are 1 km runs
        var segments: [RaceSegment] = []
        for i in 0..<8 {
            segments.append(
                RaceSegment(
                    segmentType: .run,
                    label: "Run \(i + 1)",
                    distanceMeters: runDistanceM
                )
            )
            segments.append(
                RaceSegment(
                    segmentType: .station,
                    label: stationOrder[i]
                )
            )
        }
        return segments
    }

    public static func buildHalfRace(divisionKey: String) -> [RaceSegment] {
        // First 4 run + 4 station pairs.
        Array(buildFullRace(divisionKey: divisionKey).prefix(8))
    }
}
