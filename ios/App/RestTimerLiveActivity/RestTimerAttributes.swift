import ActivityKit
import Foundation

/// ActivityKit attributes for the Rebirth rest-timer Live Activity.
///
/// - Static attributes (captured at `Activity.request`): the exercise name and
///   set number that were in scope when the timer started. These do not
///   change for the lifetime of the activity.
/// - Dynamic state (`ContentState`): the absolute `endDate` the countdown
///   targets, the original `duration` in seconds (for progress), and a
///   `paused` flag reserved for future pause/resume support.
///
/// The countdown itself is rendered with `Text(timerInterval:countsDown:)`,
/// so the system refreshes the display without us needing to push updates.
public struct RestTimerAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Absolute moment when the rest period ends.
        public var endDate: Date
        /// Original rest duration in seconds (for progress maths).
        public var duration: Int
        /// Reserved for future pause/resume — currently always false.
        public var paused: Bool
        /// When set, the rest period has elapsed and the widget should render a
        /// red count-UP from this date rather than a countdown. Corresponds to
        /// the user's "Keep Rest Timer Running" setting.
        public var overtimeStart: Date?

        public init(endDate: Date, duration: Int, paused: Bool = false, overtimeStart: Date? = nil) {
            self.endDate = endDate
            self.duration = duration
            self.paused = paused
            self.overtimeStart = overtimeStart
        }
    }

    /// Exercise the user was resting between sets of, e.g. "Back Squat".
    public var exerciseName: String
    /// Which set just finished. Displayed as "Set N".
    public var setNumber: Int

    public init(exerciseName: String, setNumber: Int) {
        self.exerciseName = exerciseName
        self.setNumber = setNumber
    }
}
