import SwiftUI
import WatchKit

// TimerView — the headline screen on the Watch.
//
// Four states drive the body:
//   - idle      → setupScreen (compact, single-tap START)
//   - countdown → countdownScreen (big number, Cancel button)
//   - running / paused → activeScreen (live race readout)
//   - complete  → completeScreen
//
// Layout decisions:
//   - The setup screen is a NavigationStack with a primary START button
//     above-the-fold. Division selection pushes to a dedicated picker
//     view so we don't burn vertical space on a watch-sized Picker.
//   - Last-used division/template/roxzone persist via `@AppStorage` so
//     the next race is one tap.
//   - Settings is a toolbar item (top-right) — surfaces sign-in / phone
//     reachability without a bottom tab bar that competed with the
//     Timer for first-launch attention.
//
// Active-screen layout follows running_pace_feature_spec.md §4:
//   - Current pace (32pt mono, primary on runs)
//   - Segment time (24pt)
//   - Avg run pace (16pt persistent reference)
//   - Total elapsed (caption)
//   - Current segment label
//   - Visible SPLIT + Pause buttons (long-press is gone — it was a
//     hidden affordance no one knew about)

private enum TimerDefaultsKey {
    static let divisionKey = "watch.timer.divisionKey"
    static let template = "watch.timer.template"
    static let simulateRoxzone = "watch.timer.simulateRoxzone"
}

/// Always 10s when started on the watch. The phone has a configurable
/// preference, but the wrist UX favors a single sensible default.
private let watchCountdownSeconds = 10

struct TimerView: View {
    @EnvironmentObject private var vm: RaceTimerViewModel
    @StateObject private var hk = HealthKitWorkoutService.shared

    // These were previously `@AppStorage`. On a fresh install the first
    // synchronous write through `@AppStorage` blocked the main thread
    // for ~9 s — `cfprefsd` (UserDefaults daemon) appears to contend
    // with the first `securityd` (Keychain) read during launch on
    // watchOS. We now hold the value in `@State` so the chip redraws
    // instantly on tap, and dispatch the actual UserDefaults write to a
    // detached background task.
    @State private var divisionKey: String = UserDefaults.standard.string(
        forKey: TimerDefaultsKey.divisionKey
    ) ?? "women_open"
    @State private var templateRaw: String = UserDefaults.standard.string(
        forKey: TimerDefaultsKey.template
    ) ?? RaceTemplate.full.rawValue
    @State private var simulateRoxzone: Bool = UserDefaults.standard.bool(
        forKey: TimerDefaultsKey.simulateRoxzone
    )

    @State private var showFinishConfirm: Bool = false
    @State private var showDiscardConfirm: Bool = false
    @State private var isStarting: Bool = false

    private let unit: PaceUnit = .kilometer  // TODO read from App Group

    private var template: RaceTemplate {
        RaceTemplate(rawValue: templateRaw) ?? .full
    }

    /// Write a setting to UserDefaults off the main thread so the UI
    /// never blocks on first-call cfprefsd warm-up.
    private func persistSetting(_ key: String, _ value: Any) {
        Task.detached(priority: .utility) {
            UserDefaults.standard.set(value, forKey: key)
        }
    }

    var body: some View {
        switch vm.state.status {
        case .idle:
            setupScreen
        case .countdown:
            countdownScreen
        case .running, .paused:
            activeScreen
        case .complete:
            completeScreen
        }
    }

    // MARK: - Setup

    private var setupScreen: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 8) {
                    // Primary action — sits above-the-fold so the user
                    // doesn't have to scroll on a 41mm watch.
                    Button {
                        startRace()
                    } label: {
                        HStack(spacing: 6) {
                            if isStarting {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "flag.checkered")
                            }
                            Text(isStarting ? "Starting…" : "START RACE")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                    .disabled(isStarting)

                    // Template chips
                    HStack(spacing: 6) {
                        templateChip(.full, label: "Full")
                        templateChip(.half, label: "Half")
                    }

                    // Division row — pushes to dedicated picker
                    NavigationLink {
                        DivisionPickerView(selection: $divisionKey)
                    } label: {
                        HStack {
                            Text("Division")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(divisionLabel(divisionKey))
                                .font(.caption)
                                .lineLimit(1)
                        }
                    }

                    // Roxzone toggle
                    Toggle(isOn: $simulateRoxzone) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Simulate Roxzone")
                                .font(.caption)
                            Text("+100m run between stations")
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.switch)
                }
                .padding(.horizontal, 4)
            }
            .navigationTitle("HYROX")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Image(systemName: "gear")
                    }
                }
            }
            .onChange(of: divisionKey) { _, newValue in
                persistSetting(TimerDefaultsKey.divisionKey, newValue)
            }
            .onChange(of: simulateRoxzone) { _, newValue in
                persistSetting(TimerDefaultsKey.simulateRoxzone, newValue)
            }
            // Request HealthKit permission proactively while the user is
            // still on the setup screen, so the system dialog never
            // interrupts a running timer. No-op once granted/denied.
            .task {
                if hk.permissionState == .notRequested {
                    _ = await hk.requestPermissions()
                }
            }
        }
    }

    @ViewBuilder
    private func templateChip(_ value: RaceTemplate, label: String) -> some View {
        let selected = template == value
        Button(label) {
            templateRaw = value.rawValue
            persistSetting(TimerDefaultsKey.template, value.rawValue)
        }
        .font(.caption)
        .frame(maxWidth: .infinity)
        .tint(selected ? .green : .gray)
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
    }

    private func startRace() {
        guard !isStarting else { return }
        isStarting = true
        Task {
            // Belt-and-suspenders: if the user taps START before the
            // setup-screen `.task` has finished requesting permission,
            // await it here so the system dialog never appears with a
            // race clock already ticking.
            if hk.permissionState == .notRequested {
                _ = await hk.requestPermissions()
            }
            vm.configure(
                divisionKey: divisionKey,
                template: template,
                simulateRoxzone: simulateRoxzone
            )
            await vm.start(countdownSeconds: watchCountdownSeconds)
            isStarting = false
        }
    }

    private func divisionLabel(_ key: String) -> String {
        switch key {
        case "women_open": return "Women Open"
        case "men_open": return "Men Open"
        case "women_pro": return "Women Pro"
        case "men_pro": return "Men Pro"
        default: return key
        }
    }

    // MARK: - Countdown

    private var countdownScreen: some View {
        VStack(spacing: 6) {
            Text("Get ready")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            Text("\(vm.countdownRemainingSec)")
                .font(.system(size: 72, weight: .bold, design: .monospaced))
                .foregroundStyle(.green)
                .contentTransition(.numericText(countsDown: true))
                .animation(.snappy, value: vm.countdownRemainingSec)
            Button(role: .cancel) {
                vm.cancelCountdown()
            } label: {
                Label("Cancel", systemImage: "xmark")
                    .font(.caption)
            }
            .controlSize(.small)
            .padding(.top, 4)
        }
        .padding(.horizontal, 6)
    }

    // MARK: - Active

    private var activeScreen: some View {
        VStack(spacing: 4) {
            // Current segment label
            Text(currentLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            // Pace primary
            if isOnRun {
                Text(PaceComputation.format(secPerKm: vm.currentRunPaceSecPerKm, unit: unit))
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundStyle(.blue)
            } else {
                Text("—")
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            // Segment time (medium)
            Text(formatTime(ms: vm.segmentElapsedMs))
                .font(.system(size: 24, weight: .semibold, design: .monospaced))
                .minimumScaleFactor(0.5)
                .lineLimit(1)

            // Avg run pace
            HStack(spacing: 4) {
                Text("avg")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text(PaceComputation.format(secPerKm: vm.avgRunPaceSecPerKm, unit: unit))
                    .font(.system(size: 16, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            // Total elapsed
            Text("Total \(formatTime(ms: vm.totalElapsedMs))")
                .font(.caption2)
                .foregroundStyle(.secondary)

            // Action buttons
            actionButtons
                .padding(.top, 4)
        }
        .padding(.horizontal, 6)
        .confirmationDialog(
            "End the race?",
            isPresented: $showFinishConfirm,
            titleVisibility: .visible
        ) {
            Button("End Race", role: .destructive) {
                Task { await vm.finish() }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var actionButtons: some View {
        switch vm.state.status {
        case .running:
            VStack(spacing: 4) {
                // Primary tap target — large and obvious.
                Button(action: { vm.split() }) {
                    Text(isLastSegment ? "FINISH" : "SPLIT")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .tint(isLastSegment ? .red : .green)

                // Secondary: visible Pause button. Replaces the
                // long-press-on-SPLIT gesture that nobody knew about.
                Button(action: { vm.pause() }) {
                    Label("Pause", systemImage: "pause.circle")
                        .font(.caption2)
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.mini)
                .tint(.orange)
            }
        case .paused:
            HStack {
                Button("Resume") { vm.resume() }
                    .tint(.green)
                Button("End") { showFinishConfirm = true }
                    .tint(.red)
            }
        default:
            EmptyView()
        }
    }

    // MARK: - Complete

    private var completeScreen: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("Race Complete")
                    .font(.headline)
                Text(formatTime(ms: vm.totalElapsedMs))
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                if let avg = vm.avgRunPaceSecPerKm {
                    Text("avg run \(PaceComputation.format(secPerKm: avg, unit: unit))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Phone-origin races: the phone owns the save. Show a
                // passive notice and a Done button to clear the watch
                // back to setup.
                if vm.state.source == .phone {
                    Label("Saving on iPhone", systemImage: "iphone")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Button("Done") {
                        vm.dismissCompleteScreen()
                    }
                    .padding(.top, 4)
                } else if vm.savedThisRace {
                    // Post-save (watch-origin): show sync status + Done.
                    if vm.state.pendingSync {
                        Label("Syncing…", systemImage: "arrow.triangle.2.circlepath")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Label("Synced", systemImage: "checkmark.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.green)
                    }
                    Button("Done") {
                        vm.dismissCompleteScreen()
                    }
                    .padding(.top, 4)
                } else {
                    // Pre-save (watch-origin): explicit Save / Discard.
                    Button {
                        vm.saveRace()
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.down")
                            Text("Save Race")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .tint(.green)
                    .padding(.top, 4)

                    Button(role: .destructive) {
                        showDiscardConfirm = true
                    } label: {
                        Text("Discard")
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .confirmationDialog(
            "Discard this race?",
            isPresented: $showDiscardConfirm,
            titleVisibility: .visible
        ) {
            Button("Discard Race", role: .destructive) {
                vm.discardRace()
            }
            Button("Keep", role: .cancel) {}
        } message: {
            Text("Your splits and total time will be lost forever.")
        }
    }

    // MARK: - Derived

    private var currentLabel: String {
        let idx = vm.state.currentSegmentIndex
        guard idx < vm.state.segments.count else { return "Done" }
        return vm.state.segments[idx].label
    }

    private var isOnRun: Bool {
        let idx = vm.state.currentSegmentIndex
        guard idx < vm.state.segments.count else { return false }
        return vm.state.segments[idx].segmentType == .run
    }

    private var isLastSegment: Bool {
        vm.state.currentSegmentIndex >= vm.state.segments.count - 1
    }

    private func formatTime(ms: Double) -> String {
        let totalSec = Int(ms / 1000)
        let h = totalSec / 3600
        let m = (totalSec % 3600) / 60
        let s = totalSec % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - DivisionPickerView

private struct DivisionPickerView: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss

    private let options: [(key: String, label: String)] = [
        ("women_open", "Women Open"),
        ("men_open", "Men Open"),
        ("women_pro", "Women Pro"),
        ("men_pro", "Men Pro"),
    ]

    var body: some View {
        List {
            ForEach(options, id: \.key) { opt in
                Button {
                    selection = opt.key
                    dismiss()
                } label: {
                    HStack {
                        Text(opt.label)
                        Spacer()
                        if selection == opt.key {
                            Image(systemName: "checkmark")
                                .foregroundStyle(.green)
                        }
                    }
                }
            }
        }
        .navigationTitle("Division")
        .navigationBarTitleDisplayMode(.inline)
    }
}
