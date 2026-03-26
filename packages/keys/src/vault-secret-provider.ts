import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { join } from "node:path";
import { existsSync, chmodSync, mkdirSync } from "node:fs";
import type { KeyPolicy } from "./config.js";
import type { SealedBox } from "./se-protocol.js";
import {
  seCreate,
  seEncrypt,
  seDecrypt,
  findSignerBinary,
} from "./se-bridge.js";
import { detectPlatform } from "./platform.js";

/**
 * Provides the vault encryption secret. Implementations may derive it
 * from hardware (Secure Enclave ECIES) or read it from a file.
 */
export interface VaultSecretProvider {
  /** Resolve the vault encryption secret (hex-encoded, 32 bytes). */
  getSecret(): Promise<Result<string, InternalError>>;
  /** Which provider type backs this. */
  readonly kind: "secure-enclave" | "software";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// Secure Enclave provider (ECIES)
// ---------------------------------------------------------------------------

/**
 * Create a vault secret provider backed by the Secure Enclave.
 *
 * Uses ECIES (ECDH + HKDF + AES-GCM) to protect the vault secret:
 *
 * - First run: creates a P256.KeyAgreement SE key, generates a random
 *   vault secret, encrypts it with ECIES, stores the sealed box + key ref.
 * - Subsequent runs: loads key ref + sealed box, SE decrypts via ECDH
 *   (biometric/passcode prompt fires here if policy requires it).
 *
 * The vault secret never exists on disk in plaintext.
 *
 * @param dataDir - Root data directory (key ref + sealed box stored here)
 * @param signerPath - Path to the signet-signer binary
 * @param policy - SE key access policy (default: "open")
 */
export function createSeVaultSecretProvider(
  dataDir: string,
  signerPath: string,
  policy: KeyPolicy = "open",
): VaultSecretProvider {
  let cached: string | null = null;
  let inflight: Promise<Result<string, InternalError>> | null = null;

  const keyRefPath = join(dataDir, "se-vault-keyref");
  const sealedBoxPath = join(dataDir, "vault-sealed-box.json");
  const publicKeyPath = join(dataDir, "se-vault-pubkey");

  async function resolveSecret(): Promise<Result<string, InternalError>> {
    try {
      // Ensure data dir exists
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
        chmodSync(dataDir, 0o700);
      }

      if (existsSync(keyRefPath) && existsSync(sealedBoxPath)) {
        // --- Subsequent run: decrypt ---
        const keyRef = await Bun.file(keyRefPath).text();
        const sealedBoxJson = await Bun.file(sealedBoxPath).text();
        const sealedBox: SealedBox = JSON.parse(sealedBoxJson) as SealedBox;

        const decryptResult = await seDecrypt(keyRef, sealedBox, signerPath);
        if (Result.isError(decryptResult)) {
          return Result.err(
            InternalError.create("Failed to decrypt vault secret from SE", {
              cause: decryptResult.error.message,
            }),
          );
        }

        cached = decryptResult.value.plaintext;
        return Result.ok(cached);
      }

      // --- First run: create key + encrypt ---

      // 1. Create SE key-agreement key
      const createResult = await seCreate(
        "signet-vault-root",
        policy,
        signerPath,
        "key-agreement",
      );
      if (Result.isError(createResult)) {
        return Result.err(
          InternalError.create("Failed to create SE vault key", {
            cause: createResult.error.message,
          }),
        );
      }

      // Persist key reference and public key
      await Bun.write(keyRefPath, createResult.value.keyRef);
      chmodSync(keyRefPath, 0o600);
      await Bun.write(publicKeyPath, createResult.value.publicKey);
      chmodSync(publicKeyPath, 0o600);

      // 2. Generate random vault secret
      const secretBytes = crypto.getRandomValues(new Uint8Array(32));
      const secretHex = bytesToHex(secretBytes);

      // 3. ECIES encrypt (pure TypeScript, no SE needed)
      const sealedBox = seEncrypt(createResult.value.publicKey, secretBytes);

      // 4. Persist sealed box
      await Bun.write(sealedBoxPath, JSON.stringify(sealedBox, null, 2));
      chmodSync(sealedBoxPath, 0o600);

      // 5. Zeroize secret bytes
      secretBytes.fill(0);

      cached = secretHex;
      return Result.ok(cached);
    } catch (e) {
      return Result.err(
        InternalError.create("SE vault secret provider failed", {
          cause: String(e),
        }),
      );
    }
  }

  return {
    kind: "secure-enclave",

    async getSecret(): Promise<Result<string, InternalError>> {
      if (cached !== null) return Result.ok(cached);

      // Serialize concurrent calls to prevent double-initialization
      if (inflight !== null) return inflight;
      inflight = resolveSecret();
      try {
        return await inflight;
      } finally {
        inflight = null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Software provider
// ---------------------------------------------------------------------------

/**
 * Create a vault secret provider backed by a file on disk.
 *
 * On first run: generates a random 32-byte secret and writes it to
 * `dataDir/vault-passphrase` with 0o600 permissions.
 *
 * On subsequent runs: reads the secret from disk.
 *
 * Fallback for platforms without Secure Enclave support.
 *
 * @param dataDir - Root data directory (secret file stored here)
 */
export function createSoftwareVaultSecretProvider(
  dataDir: string,
): VaultSecretProvider {
  let cached: string | null = null;

  return {
    kind: "software",

    async getSecret(): Promise<Result<string, InternalError>> {
      if (cached !== null) return Result.ok(cached);

      const secretPath = join(dataDir, "vault-passphrase");

      try {
        if (!existsSync(dataDir)) {
          mkdirSync(dataDir, { recursive: true });
          chmodSync(dataDir, 0o700);
        }

        if (existsSync(secretPath)) {
          cached = await Bun.file(secretPath).text();
        } else {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          cached = bytesToHex(bytes);
          await Bun.write(secretPath, cached);
          chmodSync(secretPath, 0o600);
        }
        return Result.ok(cached);
      } catch (e) {
        return Result.err(
          InternalError.create("Failed to resolve software vault secret", {
            cause: String(e),
          }),
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Resolve the appropriate vault secret provider for the current platform.
 *
 * On macOS with Secure Enclave available: uses SE-backed ECIES provider.
 * Otherwise: falls back to software file-based provider.
 *
 * @param dataDir - Root data directory
 * @param policy - SE key access policy (default: "open")
 */
export function resolveVaultSecretProvider(
  dataDir: string,
  policy: KeyPolicy = "open",
): VaultSecretProvider {
  // If a legacy software vault-passphrase file exists, always use the
  // software provider — even on SE-capable machines. Switching providers
  // would create a new SE-backed secret and strand the existing vault data.
  const legacyPath = join(dataDir, "vault-passphrase");
  if (existsSync(legacyPath)) {
    return createSoftwareVaultSecretProvider(dataDir);
  }

  // If an SE sealed box already exists, use the SE provider regardless
  // of current platform detection (the vault was created with SE).
  const sealedBoxPath = join(dataDir, "vault-sealed-box.json");
  if (existsSync(sealedBoxPath)) {
    const signerPath = findSignerBinary();
    if (signerPath) {
      return createSeVaultSecretProvider(dataDir, signerPath, policy);
    }
    // SE sealed box exists but no signer binary — can't decrypt
    return {
      kind: "software" as const,
      async getSecret() {
        return Result.err(
          InternalError.create(
            "Vault was created with Secure Enclave but signet-signer binary not found. " +
              "Cannot decrypt vault secret.",
          ),
        );
      },
    };
  }

  // Fresh data dir — choose based on platform
  const platform = detectPlatform();

  if (platform === "secure-enclave") {
    const signerPath = findSignerBinary();
    if (signerPath) {
      return createSeVaultSecretProvider(dataDir, signerPath, policy);
    }
  }

  return createSoftwareVaultSecretProvider(dataDir);
}
