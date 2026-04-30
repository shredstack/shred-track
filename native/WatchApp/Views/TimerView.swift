import SwiftUI
import WatchKit

// TimerView — the headline screen on the Watch.
//
// Two states: setup (pick division + template, START) and active
// (live race readout). Layout follows running_pace_feature_spec.md §4:
//   - Current pace (32pt mono, primary on runs)
//   - Segment time (24pt)
//   - Avg run pace (16pt persistent reference)
//   - Total elapsed (caption)
//   - Current segment label

struct TimerView: View {
    @StateObject private var vm = RaceTimerViewModel()
    @State private var divisionKey: String = "women_open"
    @State private var template: RaceTemplate = .full
    @State private var showFinishConfirm: Bool = false

    private let unit: PaceUnit = .kilometer  // TODO read from App Group

    var body: some View {
        switch vm.state.status {
        case .idle:
            setupScreen
        case .running, .paused:
            activeScreen
        case .complete:
            completeScreen
        }
    }

    // MARK: - Setup

    private var setupScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("HYROX Race")
                    .font(.headline)
                Picker("Division", selection: $divisionKey) {
                    Text("Women Open").tag("women_open")
                    Text("Men Open").tag("men_open")
                    Text("Women Pro").tag("women_pro")
                    Text("Men Pro").tag("men_pro")
                }
                Picker("Template", selection: $template) {
                    Text("Full").tag(RaceTemplate.full)
                    Text("Half").tag(RaceTemplate.half)
                }
                Button {
                    Task {
                        vm.configure(divisionKey: divisionKey, template: template)
                        await vm.start()
                    }
                } label: {
                    Text("START")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .tint(.green)
                .padding(.top, 4)
            }
            .padding(.horizontal, 4)
        }
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

            // Action button
            actionButton
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
    private var actionButton: some View {
        switch vm.state.status {
        case .running:
            Button(action: { vm.split() }) {
                Text(isLastSegment ? "FINISH" : "SPLIT")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .tint(isLastSegment ? .red : .green)
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.6).onEnded { _ in
                    vm.pause()
                }
            )
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
            VStack(spacing: 12) {
                Text("Race Complete")
                    .font(.headline)
                Text(formatTime(ms: vm.totalElapsedMs))
                    .font(.system(size: 28, weight: .bold, design: .monospaced))
                if let avg = vm.avgRunPaceSecPerKm {
                    Text("avg run \(PaceComputation.format(secPerKm: avg, unit: unit))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if vm.state.pendingSync {
                    Label("Syncing…", systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Label("Synced", systemImage: "checkmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
                Button("New Race") {
                    vm.configure(divisionKey: divisionKey, template: template)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 4)
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
