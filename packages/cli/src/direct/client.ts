import { z } from "zod";
import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { XmtpClient, SignerProviderLike } from "@xmtp/signet-core";
import type { KeyManager } from "@xmtp/signet-keys";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Configuration for direct mode (no daemon). */
export type DirectModeConfig = {
  env: "local" | "dev" | "production";
  dataDir: string;
};

type DirectModeConfigInput = {
  env?: "local" | "dev" | "production" | undefined;
  dataDir: string;
};

export const DirectModeConfigSchema: z.ZodType<
  DirectModeConfig,
  z.ZodTypeDef,
  DirectModeConfigInput
> = z
  .object({
    env: z
      .enum(["local", "dev", "production"])
      .default("dev")
      .describe("XMTP network environment"),
    dataDir: z.string().describe("Data directory containing the vault"),
  })
  .describe("Direct mode configuration");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One-shot XMTP client for direct mode (no daemon, vault-based keys). */
export interface DirectClient {
  readonly mode: "direct";
  readonly xmtpClient: XmtpClient;
  close(): Promise<void>;
}

/**
 * Injectable dependencies for testing.
 * Production code injects real createKeyManager and createSdkClientFactory.
 */
export interface DirectModeDeps {
  createKeyManager: (config: {
    dataDir: string;
  }) => Promise<Result<Partial<KeyManager>, SignetError>>;
  createXmtpClient: (
    config: { env: string; dataDir: string },
    signerProvider: SignerProviderLike,
  ) => Promise<Result<XmtpClient, SignetError>>;
  closed?: Array<() => void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIRECT_IDENTITY_ID = "direct-mode";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Create a one-shot XMTP client for direct mode.
 *
 * Direct mode accesses key material exclusively through the vault
 * (software-vault for testing, Secure Enclave on macOS in production).
 * No raw keys are ever exposed via environment variables, keyfiles,
 * or CLI arguments.
 */
export async function createDirectClient(
  config: DirectModeConfig,
  deps: DirectModeDeps,
): Promise<Result<DirectClient, SignetError>> {
  // 1. Create key manager from vault in dataDir
  const kmResult = await deps.createKeyManager({
    dataDir: config.dataDir,
  });
  if (Result.isError(kmResult)) return kmResult;
  const keyManager = kmResult.value;

  // 2. Initialize root key (unlocks vault)
  if (keyManager.initialize !== undefined) {
    const initResult = await keyManager.initialize();
    if (Result.isError(initResult)) {
      keyManager.close?.();
      return initResult;
    }
  }

  // 3. Ensure an operational key exists for the direct identity
  if (keyManager.createOperationalKey !== undefined) {
    const existingKey = keyManager.getOperationalKey?.(DIRECT_IDENTITY_ID);
    if (existingKey === undefined || Result.isError(existingKey)) {
      const opResult = await keyManager.createOperationalKey(
        DIRECT_IDENTITY_ID,
        null,
      );
      if (Result.isError(opResult)) {
        keyManager.close?.();
        return opResult;
      }
    }
  }

  // 4. Build a signer provider for the direct identity
  const signerProvider: SignerProviderLike = {
    async sign(data: Uint8Array): Promise<Result<Uint8Array, SignetError>> {
      if (keyManager.signWithOperationalKey === undefined) {
        return Result.err(
          InternalError.create("Key manager does not support signing"),
        );
      }
      return keyManager.signWithOperationalKey(DIRECT_IDENTITY_ID, data);
    },
    async getPublicKey(): Promise<Result<Uint8Array, SignetError>> {
      if (keyManager.getOperationalKey === undefined) {
        return Result.err(
          InternalError.create("Key manager does not support key retrieval"),
        );
      }
      const opKey = keyManager.getOperationalKey(DIRECT_IDENTITY_ID);
      if (Result.isError(opKey)) return opKey;
      const hex = opKey.value.publicKey;
      const bytes = hexToBytes(hex);
      return Result.ok(bytes);
    },
    async getFingerprint(): Promise<Result<string, SignetError>> {
      if (keyManager.getOperationalKey === undefined) {
        return Result.err(
          InternalError.create("Key manager does not support key retrieval"),
        );
      }
      const opKey = keyManager.getOperationalKey(DIRECT_IDENTITY_ID);
      if (Result.isError(opKey)) return opKey;
      return Result.ok(opKey.value.fingerprint);
    },
    async getDbEncryptionKey(): Promise<Result<Uint8Array, SignetError>> {
      if (keyManager.getOrCreateDbKey === undefined) {
        return Result.err(
          InternalError.create(
            "Key manager does not support DB key generation",
          ),
        );
      }
      return keyManager.getOrCreateDbKey(DIRECT_IDENTITY_ID);
    },
    async getXmtpIdentityKey(): Promise<Result<`0x${string}`, SignetError>> {
      if (keyManager.getOrCreateXmtpIdentityKey === undefined) {
        return Result.err(
          InternalError.create(
            "Key manager does not support XMTP identity key retrieval",
          ),
        );
      }
      return keyManager.getOrCreateXmtpIdentityKey(DIRECT_IDENTITY_ID);
    },
  };

  // 5. Create the XMTP client
  const clientResult = await deps.createXmtpClient(
    { env: config.env, dataDir: config.dataDir },
    signerProvider,
  );
  if (Result.isError(clientResult)) {
    keyManager.close?.();
    return clientResult;
  }

  const xmtpClient = clientResult.value;

  // 6. Return the DirectClient wrapper
  const directClient: DirectClient = {
    mode: "direct",
    xmtpClient,
    async close(): Promise<void> {
      keyManager.close?.();
    },
  };

  return Result.ok(directClient);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const length = hex.length / 2;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
