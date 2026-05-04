import Foundation
import OSLog

/// Watch-side logger. Mirrors os_log to a rotating file in the App Group so
/// the phone's `/dev/watch-log` viewer can surface the last ~1000 lines.
public final class RebirthWatchLog: @unchecked Sendable {
    public static let shared = RebirthWatchLog()

    private let logger = Logger(subsystem: "app.rebirth.watch", category: "watch")
    private let fileURL: URL?
    private let queue = DispatchQueue(label: "app.rebirth.watch.log", qos: .utility)
    private let maxLines = 1000

    private init() {
        let groupID = "group.app.rebirth"
        self.fileURL = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: groupID)?
            .appendingPathComponent("watch-log.txt")
    }

    public func info(_ message: String, file: String = #fileID, line: Int = #line) {
        logger.info("\(message, privacy: .public)")
        append("INFO  \(file):\(line) \(message)")
    }

    public func error(_ message: String, file: String = #fileID, line: Int = #line) {
        logger.error("\(message, privacy: .public)")
        append("ERROR \(file):\(line) \(message)")
    }

    public func debug(_ message: String, file: String = #fileID, line: Int = #line) {
        logger.debug("\(message, privacy: .public)")
        append("DEBUG \(file):\(line) \(message)")
    }

    private func append(_ line: String) {
        guard let url = fileURL else { return }
        let stamped = "[\(ISO8601DateFormatter().string(from: Date()))] \(line)\n"
        queue.async { [maxLines] in
            // Rotate by reading existing content, trimming, rewriting. Cheap at this size.
            var existing: [String] = []
            if let data = try? Data(contentsOf: url),
               let s = String(data: data, encoding: .utf8) {
                existing = s.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            }
            existing.append(stamped.trimmingCharacters(in: .newlines))
            if existing.count > maxLines {
                existing = Array(existing.suffix(maxLines))
            }
            let combined = existing.joined(separator: "\n") + "\n"
            try? combined.data(using: .utf8)?.write(to: url, options: .atomic)
        }
    }
}
