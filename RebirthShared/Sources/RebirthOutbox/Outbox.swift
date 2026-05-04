import Foundation
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog
import SQLite3

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

public enum OutboxError: Error {
    case noContainer
    case open(String)
    case execute(String)
    case bind(String)
}

public struct PendingMutation: Sendable, Equatable {
    public let mutationId: String
    public let endpoint: String
    public let bodyJSON: Data
    public let createdAt: Date
    public let attemptCount: Int
    public let lastAttemptAt: Date?
    public let lastError: String?
}

/// SQLite-backed outbox. One row per pending mutation. Atomic writes survive
/// watch process suspension. Populated by the watch UI; drained by a flusher
/// triggered on `NWPathMonitor` connectivity changes.
public final class RebirthOutbox: @unchecked Sendable {
    private let url: URL
    private var db: OpaquePointer?
    private let lock = NSLock()
    private let log = RebirthWatchLog.shared

    public init(appGroup: RebirthAppGroup = .init()) throws {
        guard let url = appGroup.outboxURL else { throw OutboxError.noContainer }
        self.url = url
        try open()
        try migrate()
    }

    deinit {
        if let db { sqlite3_close(db) }
    }

    private func open() throws {
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else {
            let msg = handle.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            sqlite3_close(handle)
            throw OutboxError.open(msg)
        }
        db = handle
    }

    private func migrate() throws {
        try exec("""
            CREATE TABLE IF NOT EXISTS pending_mutation (
                mutation_id TEXT PRIMARY KEY,
                endpoint TEXT NOT NULL,
                body_json BLOB NOT NULL,
                created_at INTEGER NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_attempt_at INTEGER,
                last_error TEXT
            );
        """)
        try exec("CREATE INDEX IF NOT EXISTS idx_pending_created ON pending_mutation(created_at);")
    }

    private func exec(_ sql: String) throws {
        lock.lock(); defer { lock.unlock() }
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "unknown"
            sqlite3_free(err)
            throw OutboxError.execute(msg)
        }
    }

    // MARK: - public API

    public func enqueue(mutationId: String, endpoint: String, body: Data) throws {
        lock.lock(); defer { lock.unlock() }
        let sql = """
            INSERT OR REPLACE INTO pending_mutation
            (mutation_id, endpoint, body_json, created_at, attempt_count)
            VALUES (?, ?, ?, ?, 0);
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw OutboxError.bind(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, mutationId, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, endpoint, -1, SQLITE_TRANSIENT)
        _ = body.withUnsafeBytes { ptr in
            sqlite3_bind_blob(stmt, 3, ptr.baseAddress, Int32(body.count), SQLITE_TRANSIENT)
        }
        sqlite3_bind_int64(stmt, 4, Int64(Date().timeIntervalSince1970 * 1000))
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw OutboxError.execute(String(cString: sqlite3_errmsg(db)))
        }
    }

    public func pending(limit: Int = 50) throws -> [PendingMutation] {
        lock.lock(); defer { lock.unlock() }
        let sql = """
            SELECT mutation_id, endpoint, body_json, created_at, attempt_count, last_attempt_at, last_error
            FROM pending_mutation
            ORDER BY created_at ASC
            LIMIT ?;
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw OutboxError.bind(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int(stmt, 1, Int32(limit))
        var results: [PendingMutation] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            guard let idCStr = sqlite3_column_text(stmt, 0),
                  let endpointCStr = sqlite3_column_text(stmt, 1) else { continue }
            let id = String(cString: idCStr)
            let endpoint = String(cString: endpointCStr)
            let blobBytes = sqlite3_column_bytes(stmt, 2)
            let blobPtr = sqlite3_column_blob(stmt, 2)
            let body = blobPtr != nil ? Data(bytes: blobPtr!, count: Int(blobBytes)) : Data()
            let createdAt = Date(timeIntervalSince1970: Double(sqlite3_column_int64(stmt, 3)) / 1000)
            let attempts = Int(sqlite3_column_int(stmt, 4))
            let lastAttempt: Date? = sqlite3_column_type(stmt, 5) == SQLITE_NULL
                ? nil
                : Date(timeIntervalSince1970: Double(sqlite3_column_int64(stmt, 5)) / 1000)
            let lastError: String? = sqlite3_column_type(stmt, 6) == SQLITE_NULL
                ? nil
                : sqlite3_column_text(stmt, 6).map { String(cString: $0) }
            results.append(.init(
                mutationId: id,
                endpoint: endpoint,
                bodyJSON: body,
                createdAt: createdAt,
                attemptCount: attempts,
                lastAttemptAt: lastAttempt,
                lastError: lastError
            ))
        }
        return results
    }

    public func remove(mutationId: String) throws {
        lock.lock(); defer { lock.unlock() }
        let sql = "DELETE FROM pending_mutation WHERE mutation_id = ?;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw OutboxError.bind(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, mutationId, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw OutboxError.execute(String(cString: sqlite3_errmsg(db)))
        }
    }

    public func recordAttempt(mutationId: String, error: String?) throws {
        lock.lock(); defer { lock.unlock() }
        let sql = """
            UPDATE pending_mutation
            SET attempt_count = attempt_count + 1,
                last_attempt_at = ?,
                last_error = ?
            WHERE mutation_id = ?;
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            throw OutboxError.bind(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, Int64(Date().timeIntervalSince1970 * 1000))
        if let error {
            sqlite3_bind_text(stmt, 2, error, -1, SQLITE_TRANSIENT)
        } else {
            sqlite3_bind_null(stmt, 2)
        }
        sqlite3_bind_text(stmt, 3, mutationId, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_DONE else {
            throw OutboxError.execute(String(cString: sqlite3_errmsg(db)))
        }
    }

    public func count() throws -> Int {
        lock.lock(); defer { lock.unlock() }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM pending_mutation;", -1, &stmt, nil) == SQLITE_OK else {
            throw OutboxError.bind(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(stmt) }
        guard sqlite3_step(stmt) == SQLITE_ROW else { return 0 }
        return Int(sqlite3_column_int(stmt, 0))
    }
}
