import Foundation

/// Access control policy for Secure Enclave key operations.
public enum KeyPolicy: String, Codable, CaseIterable, Sendable {
    case open = "open"
    case passcode = "passcode"
    case biometric = "biometric"
}

// MARK: - Error Types

public enum SignetError: Error, CustomStringConvertible {
    case seUnavailable
    case creationFailed(String)
    case keyMissing(String)
    case signingFailed(String)
    case invalidHex(String)
    case authCancelled

    public var description: String {
        switch self {
        case .seUnavailable:
            return "Secure Enclave is not available on this device"
        case .creationFailed(let msg):
            return "key creation failed: \(msg)"
        case .keyMissing(let msg):
            return "key not found: \(msg)"
        case .signingFailed(let msg):
            return "signing failed: \(msg)"
        case .invalidHex(let msg):
            return "invalid hex: \(msg)"
        case .authCancelled:
            return "authentication cancelled by user"
        }
    }

    public var exitCode: Int32 {
        switch self {
        case .seUnavailable: return 1
        case .creationFailed: return 1
        case .keyMissing: return 1
        case .signingFailed: return 1
        case .invalidHex: return 1
        case .authCancelled: return 2
        }
    }
}

// MARK: - JSON Response Types

public struct CreateResponse: Codable {
    public let keyRef: String
    public let publicKey: String
    public let policy: String
    public let label: String

    public init(keyRef: String, publicKey: String, policy: String, label: String) {
        self.keyRef = keyRef
        self.publicKey = publicKey
        self.policy = policy
        self.label = label
    }
}

public struct SignResponse: Codable {
    public let signature: String

    public init(signature: String) {
        self.signature = signature
    }
}

public struct SystemInfoResponse: Codable {
    public let available: Bool
    public let chip: String?
    public let macOS: String?

    public init(available: Bool, chip: String?, macOS: String?) {
        self.available = available
        self.chip = chip
        self.macOS = macOS
    }
}

public struct KeyInfoResponse: Codable {
    public let exists: Bool

    public init(exists: Bool) {
        self.exists = exists
    }
}
