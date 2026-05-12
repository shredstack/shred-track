import Foundation

// TodayAPIClient — fetches today's HYROX session, CrossFit WOD, and
// recovery schedule directly from the ShredTrack server over HTTPS
// (spec §6.3). The Watch attaches the cached bearer token that the
// phone last pushed via `WCSession.updateApplicationContext`.
//
// Reads only. Writes (race-split sync) still flow Watch → Phone →
// Server per the existing native-app spec §5.4 — that path is
// unchanged.
//
// Failure model:
//   - 401 from any endpoint → caller falls back to cached snapshot.
//   - Network error / timeout → caller falls back to cached snapshot.
//   - No bearer token at all → `.unauthorized` so the UI shows "open
//     the iPhone app to load today's training."

@MainActor
final class TodayAPIClient {
    static let shared = TodayAPIClient()

    private let baseURL: URL
    private let session: URLSession

    private init() {
        self.baseURL = URL(string: "https://shredtrack.shredstack.net")!
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        self.session = URLSession(configuration: config)
    }

    enum FetchResult {
        case success(TodaySnapshot)
        case unauthorized
        case failure(Error)
    }

    func fetchToday() async -> FetchResult {
        guard let token = AuthSession.shared.accessToken else {
            return .unauthorized
        }
        let dateString = Self.todayLocalDateString()

        do {
            // Pass the watch's local date to every endpoint — otherwise the
            // server falls back to `new Date()` in UTC and returns the wrong
            // day's data once UTC has rolled over from local.
            async let hyroxData = get(
                "/api/hyrox/plan/today?date=\(dateString)",
                token: token
            )
            async let crossfitData = get(
                "/api/crossfit/wod/today?date=\(dateString)",
                token: token
            )
            async let recoveryData = get(
                "/api/recovery/sessions?date=\(dateString)",
                token: token
            )

            let (hyrox, crossfit, recovery) = try await (
                hyroxData, crossfitData, recoveryData
            )

            let snapshot = Self.buildSnapshot(
                date: dateString,
                hyroxJson: hyrox,
                crossfitJson: crossfit,
                recoveryJson: recovery
            )
            return .success(snapshot)
        } catch APIError.unauthorized {
            return .unauthorized
        } catch {
            return .failure(error)
        }
    }

    private enum APIError: Error {
        case unauthorized
        case http(status: Int)
        case invalidResponse
    }

    private func get(_ path: String, token: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        if http.statusCode == 401 {
            // Any 401 is treated session-wide (spec §6.3). Rather than
            // render half-stale data, blank out the section to surface
            // the "sign in expired" banner.
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(status: http.statusCode)
        }
        return data
    }

    // MARK: - Snapshot assembly

    static func todayLocalDateString() -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    static func buildSnapshot(
        date: String,
        hyroxJson: Data,
        crossfitJson: Data,
        recoveryJson: Data
    ) -> TodaySnapshot {
        let hyrox = parseHyrox(hyroxJson)
        let crossfit = parseCrossfit(crossfitJson)
        let recovery = parseRecovery(recoveryJson)
        return TodaySnapshot(
            date: date,
            generatedAt: Int(Date().timeIntervalSince1970),
            hyrox: hyrox,
            crossfit: crossfit,
            recovery: recovery
        )
    }

    // MARK: - Per-endpoint parsing

    private static func parseHyrox(_ data: Data) -> TodaySnapshot.HyroxSection {
        guard
            let obj = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any]
        else {
            return TodaySnapshot.HyroxSection(
                planTitle: nil, phase: nil, week: nil,
                dayLabel: nil, rest: false, sessions: []
            )
        }

        // The route returns `{ plan: null }` if the user has no active plan,
        // and the longer shape (with `sessions`, `week`, etc.) otherwise.
        guard let plan = obj["plan"] as? [String: Any] else {
            return TodaySnapshot.HyroxSection(
                planTitle: nil, phase: nil, week: nil,
                dayLabel: nil, rest: false, sessions: []
            )
        }

        let planTitle = plan["title"] as? String
        let week = obj["week"] as? Int
        let dayLabel = obj["dayLabel"] as? String
        let rest = obj["rest"] as? Bool ?? false

        var phaseName: String?
        if let phase = obj["phase"] as? [String: Any] {
            phaseName = phase["name"] as? String ?? phase["phase"] as? String
        }

        let sessionsRaw = obj["sessions"] as? [[String: Any]] ?? []
        let sessions = sessionsRaw.compactMap { row -> TodaySnapshot.HyroxSessionRow? in
            guard
                let id = row["id"] as? String,
                let title = row["title"] as? String
            else { return nil }
            let sessionType = (row["sessionType"] as? String) ?? "session"
            // The route returns `log: null` for unlogged sessions and a
            // populated object for logged sessions.
            let logged = (row["log"] as? [String: Any]) != nil
            let description = (row["description"] as? String) ?? ""
            // Trim description to one line for the watch — full text lives
            // on the phone.
            let summary = description
                .split(whereSeparator: { $0.isNewline })
                .first
                .map(String.init) ?? ""
            return TodaySnapshot.HyroxSessionRow(
                sessionId: id,
                sessionType: sessionType,
                title: title,
                summary: summary,
                logged: logged
            )
        }

        return TodaySnapshot.HyroxSection(
            planTitle: planTitle,
            phase: phaseName,
            week: week,
            dayLabel: dayLabel,
            rest: rest,
            sessions: sessions
        )
    }

    private static func parseCrossfit(_ data: Data) -> TodaySnapshot.CrossfitSection {
        guard
            let obj = (try? JSONSerialization.jsonObject(with: data))
                as? [String: Any],
            let rows = obj["workouts"] as? [[String: Any]]
        else {
            return TodaySnapshot.CrossfitSection(workouts: [])
        }
        let workouts = rows.compactMap { row -> TodaySnapshot.CrossfitWorkoutRow? in
            guard
                let id = row["id"] as? String,
                let title = row["title"] as? String
            else { return nil }
            let community = (row["community"] as? [String: Any])?["name"]
                as? String ?? ""
            let description = (row["description"] as? String)
                ?? (row["rawText"] as? String)
                ?? ""
            let summary = description
                .split(whereSeparator: { $0.isNewline })
                .first
                .map(String.init) ?? ""
            let logged = (row["loggedByUser"] as? Bool) ?? false
            return TodaySnapshot.CrossfitWorkoutRow(
                workoutId: id,
                title: title,
                summary: summary,
                communityName: community,
                logged: logged
            )
        }
        return TodaySnapshot.CrossfitSection(workouts: workouts)
    }

    private static func parseRecovery(_ data: Data) -> TodaySnapshot.RecoverySection {
        guard
            let rows = (try? JSONSerialization.jsonObject(with: data))
                as? [[String: Any]]
        else {
            return TodaySnapshot.RecoverySection(items: [])
        }
        let items = rows.compactMap { row -> TodaySnapshot.RecoveryItemRow? in
            guard
                let schedule = row["schedule"] as? [String: Any],
                let scheduleId = schedule["id"] as? String
            else { return nil }
            let scheduleName = (schedule["name"] as? String) ?? "Recovery"

            let slots = (row["slots"] as? [[String: Any]]) ?? []
            let count = slots.count
            let slotsSummary: String
            if count == 0 {
                slotsSummary = "—"
            } else if count == 1 {
                slotsSummary = "1 movement"
            } else {
                slotsSummary = "\(count) movements"
            }

            let status: String
            if let session = row["session"] as? [String: Any],
               let s = session["status"] as? String {
                // The recovery sessions table uses "complete" for the
                // completed status (per useUpdateRecoverySession). Normalize
                // for the watch UI.
                status = s == "complete" ? "completed" : s
            } else {
                status = "scheduled"
            }

            return TodaySnapshot.RecoveryItemRow(
                scheduleId: scheduleId,
                scheduleName: scheduleName,
                slotsSummary: slotsSummary,
                status: status
            )
        }
        return TodaySnapshot.RecoverySection(items: items)
    }
}
