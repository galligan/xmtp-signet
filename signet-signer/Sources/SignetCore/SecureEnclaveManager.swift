import Foundation
import CryptoKit
import Security

public class SecureEnclaveManager {

    public init() {}

    // MARK: - Key Creation

    public func createKey(policy: KeyPolicy) throws -> (dataRepresentation: Data, publicKey: Data) {
        guard SecureEnclave.isAvailable else {
            throw SignetError.seUnavailable
        }

        var flags: SecAccessControlCreateFlags = [.privateKeyUsage]
        switch policy {
        case .open:
            break
        case .passcode:
            flags.insert(.devicePasscode)
        case .biometric:
            flags.insert(.biometryCurrentSet)
        }

        var error: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            flags,
            &error
        ) else {
            throw SignetError.creationFailed(
                "failed to create access control: \(error?.takeRetainedValue().localizedDescription ?? "unknown")"
            )
        }

        let privateKey: SecureEnclave.P256.Signing.PrivateKey
        do {
            privateKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)
        } catch {
            if isAuthCancelled(error) {
                throw SignetError.authCancelled
            }
            throw SignetError.creationFailed("SE key generation failed: \(error.localizedDescription)")
        }

        let dataRep = privateKey.dataRepresentation
        let publicKeyBytes = Data(privateKey.publicKey.x963Representation)

        return (dataRepresentation: dataRep, publicKey: publicKeyBytes)
    }

    // MARK: - Key Lookup

    /// Check if a key exists by trying to load it from dataRepresentation.
    public func lookupKey(_ base64DataRep: String) -> Bool {
        guard let dataRep = Data(base64Encoded: base64DataRep) else {
            return false
        }
        do {
            _ = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: dataRep)
            return true
        } catch {
            return false
        }
    }

    // MARK: - Signing

    public func signData(_ data: Data, dataRepresentation: Data) throws -> Data {
        let privateKey: SecureEnclave.P256.Signing.PrivateKey
        do {
            privateKey = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: dataRepresentation)
        } catch {
            throw SignetError.keyMissing("failed to load SE key: \(error.localizedDescription)")
        }

        do {
            if data.count == 32 {
                // Pre-hashed signing: caller passes a 32-byte digest.
                // Cast to SHA256Digest to avoid CryptoKit double-hashing.
                let digest: SHA256Digest = data.withUnsafeBytes { ptr in
                    ptr.baseAddress!.assumingMemoryBound(to: SHA256Digest.self).pointee
                }
                let signature = try privateKey.signature(for: digest)
                return signature.derRepresentation
            } else {
                // Standard ES256: let CryptoKit hash with SHA-256
                let signature = try privateKey.signature(for: data)
                return signature.derRepresentation
            }
        } catch {
            if isAuthCancelled(error) {
                throw SignetError.authCancelled
            }
            throw SignetError.signingFailed(error.localizedDescription)
        }
    }

    // MARK: - Auth Cancellation Detection

    /// Detect LAContext authentication cancellation across macOS versions.
    private func isAuthCancelled(_ error: Error) -> Bool {
        let nsError = error as NSError
        // LAError code -2 = userCancel
        if nsError.domain == "com.apple.LocalAuthentication" && nsError.code == -2 {
            return true
        }
        // String fallback for cross-version compatibility
        let desc = error.localizedDescription.lowercased()
        return desc.contains("cancel") || desc.contains("user denied")
    }

    // MARK: - Key Deletion

    /// Best-effort deletion of an SE key.
    public func deleteKey(_ base64DataRep: String) {
        guard let dataRep = Data(base64Encoded: base64DataRep) else { return }
        guard let key = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: dataRep) else { return }

        let publicKeySHA1 = Data(Insecure.SHA1.hash(data: key.publicKey.x963Representation))
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecAttrApplicationLabel as String: publicKeySHA1 as CFData,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - System Info

    public func isAvailable() -> Bool {
        SecureEnclave.isAvailable
    }

    public func getChipName() -> String {
        var size: Int = 0
        sysctlbyname("machdep.cpu.brand_string", nil, &size, nil, 0)
        if size > 0 {
            var result = [CChar](repeating: 0, count: size)
            sysctlbyname("machdep.cpu.brand_string", &result, &size, nil, 0)
            return String(cString: result)
        }
        size = 0
        sysctlbyname("hw.chip", nil, &size, nil, 0)
        if size > 0 {
            var result = [CChar](repeating: 0, count: size)
            sysctlbyname("hw.chip", &result, &size, nil, 0)
            return String(cString: result)
        }
        return "Unknown"
    }

    public func getMacOSVersion() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        if v.patchVersion != 0 {
            return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
        }
        return "\(v.majorVersion).\(v.minorVersion)"
    }
}
