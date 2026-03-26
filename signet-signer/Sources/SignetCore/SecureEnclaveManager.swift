import Foundation
import CryptoKit
import Security

public class SecureEnclaveManager {

    public init() {}

    /// Purpose of the SE key — determines CryptoKit key type.
    public enum KeyPurpose: String, Codable {
        case signing = "signing"
        case keyAgreement = "key-agreement"
    }

    // MARK: - Key Creation

    public func createKey(policy: KeyPolicy, purpose: KeyPurpose = .signing) throws -> (dataRepresentation: Data, publicKey: Data) {
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

        switch purpose {
        case .signing:
            let privateKey: SecureEnclave.P256.Signing.PrivateKey
            do {
                privateKey = try SecureEnclave.P256.Signing.PrivateKey(accessControl: accessControl)
            } catch {
                if isAuthCancelled(error) {
                    throw SignetError.authCancelled
                }
                throw SignetError.creationFailed("SE key generation failed: \(error.localizedDescription)")
            }
            return (dataRepresentation: privateKey.dataRepresentation,
                    publicKey: Data(privateKey.publicKey.x963Representation))

        case .keyAgreement:
            let privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey
            do {
                privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: accessControl)
            } catch {
                if isAuthCancelled(error) {
                    throw SignetError.authCancelled
                }
                throw SignetError.creationFailed("SE key-agreement generation failed: \(error.localizedDescription)")
            }
            return (dataRepresentation: privateKey.dataRepresentation,
                    publicKey: Data(privateKey.publicKey.x963Representation))
        }
    }

    // MARK: - Key Lookup

    /// Check if a key exists by trying to load it from dataRepresentation.
    /// Tries both signing and key-agreement key types.
    public func lookupKey(_ base64DataRep: String) -> Bool {
        guard let dataRep = Data(base64Encoded: base64DataRep) else {
            return false
        }
        // Try signing key first
        if (try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: dataRep)) != nil {
            return true
        }
        // Then try key-agreement key
        if (try? SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: dataRep)) != nil {
            return true
        }
        return false
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

    // MARK: - ECIES Decryption (Key Agreement)

    /// Decrypt data using ECIES: SE ECDH + HKDF-SHA256 + AES-GCM.
    ///
    /// The SE performs the ECDH step (this is where biometric fires).
    /// Then HKDF derives the AES key, and AES-GCM decrypts.
    public func decrypt(
        dataRepresentation: Data,
        ephemeralPublicKeyData: Data,
        nonce: Data,
        ciphertext: Data,
        tag: Data
    ) throws -> Data {
        // Load the key-agreement private key from SE
        let privateKey: SecureEnclave.P256.KeyAgreement.PrivateKey
        do {
            privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: dataRepresentation)
        } catch {
            if isAuthCancelled(error) {
                throw SignetError.authCancelled
            }
            throw SignetError.keyMissing("failed to load SE key-agreement key: \(error.localizedDescription)")
        }

        // Import the ephemeral public key
        let ephemeralPublicKey: P256.KeyAgreement.PublicKey
        do {
            ephemeralPublicKey = try P256.KeyAgreement.PublicKey(x963Representation: ephemeralPublicKeyData)
        } catch {
            throw SignetError.decryptionFailed("invalid ephemeral public key: \(error.localizedDescription)")
        }

        // ECDH — this triggers biometric if the key has biometric policy
        let sharedSecret: SharedSecret
        do {
            sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: ephemeralPublicKey)
        } catch {
            if isAuthCancelled(error) {
                throw SignetError.authCancelled
            }
            throw SignetError.decryptionFailed("ECDH failed: \(error.localizedDescription)")
        }

        // HKDF-SHA256 to derive AES-256 key
        let symmetricKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data("signet-vault-ecies".utf8),
            sharedInfo: Data(),
            outputByteCount: 32
        )

        // AES-GCM decrypt
        do {
            let sealedBox = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: nonce),
                ciphertext: ciphertext,
                tag: tag
            )
            let plaintext = try AES.GCM.open(sealedBox, using: symmetricKey)
            return plaintext
        } catch {
            throw SignetError.decryptionFailed("AES-GCM decryption failed: \(error.localizedDescription)")
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

    /// Best-effort deletion of an SE key. Tries both signing and key-agreement types.
    public func deleteKey(_ base64DataRep: String) {
        guard let dataRep = Data(base64Encoded: base64DataRep) else { return }

        // Try to load as signing key first, then key-agreement
        let publicKeyData: Data
        if let signingKey = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: dataRep) {
            publicKeyData = signingKey.publicKey.x963Representation
        } else if let kaKey = try? SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: dataRep) {
            publicKeyData = kaKey.publicKey.x963Representation
        } else {
            return
        }

        let publicKeySHA1 = Data(Insecure.SHA1.hash(data: publicKeyData))
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
