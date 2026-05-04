import Foundation
import RebirthKeychain
import RebirthModels
import RebirthWatchLog

public enum APIError: Error, Equatable {
    case missingAPIKey
    case invalidURL
    case unauthorized
    case clientError(Int, String)
    case serverError(Int)
    case network(URLError)
    case decoding(String)
}

/// Typed client for the subset of Rebirth endpoints the watch consumes.
/// Auth: API key from shared keychain. All requests return decoded models or
/// `APIError`. Caller is responsible for outbox enqueue on `.network` /
/// `.serverError`. `.unauthorized` should halt the outbox.
public actor RebirthAPIClient {
    public let baseURL: URL
    private let session: URLSession
    private let keychain: RebirthKeychain
    private let log = RebirthWatchLog.shared

    public init(baseURL: URL, session: URLSession = .shared, keychain: RebirthKeychain = .init()) {
        self.baseURL = baseURL
        self.session = session
        self.keychain = keychain
    }

    public func pushSetCompletion(_ row: WorkoutSetCDCRow) async throws {
        var request = try buildRequest(path: "/api/sync/push", method: "POST")
        let payload = SyncPushPayload(rows: [.init(table: "workout_sets", row: row)])
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(payload)
        _ = try await perform(request, decode: EmptyResponse.self)
    }

    // MARK: - request building

    private func buildRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }
        let key: String
        do {
            key = try keychain.getAPIKey()
        } catch {
            throw APIError.missingAPIKey
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func perform<T: Decodable>(_ request: URLRequest, decode: T.Type) async throws -> T {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw APIError.serverError(-1)
            }
            switch http.statusCode {
            case 200..<300:
                if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T {
                    return empty
                }
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                do {
                    return try decoder.decode(T.self, from: data)
                } catch {
                    throw APIError.decoding(String(describing: error))
                }
            case 401:
                throw APIError.unauthorized
            case 400..<500:
                let body = String(data: data, encoding: .utf8) ?? ""
                throw APIError.clientError(http.statusCode, body)
            default:
                throw APIError.serverError(http.statusCode)
            }
        } catch let urlError as URLError {
            throw APIError.network(urlError)
        }
    }
}

private struct SyncPushPayload: Encodable {
    let rows: [Row]
    struct Row: Encodable {
        let table: String
        let row: WorkoutSetCDCRow
    }
}

public struct EmptyResponse: Codable, Sendable {
    public init() {}
}
