import { z } from "zod";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { KeyPolicySchema, PlatformCapabilitySchema } from "./config.js";
import type { KeyPolicy, PlatformCapability } from "./config.js";
import type { RootKeyHandle } from "./types.js";
import type { Vault } from "./vault.js";
import {
  generateP256KeyPair,
  exportPublicKey,
  exportPrivateKey,
  importP256PrivateKey,
  signP256,
  toHex,
} from "./crypto-keys.js";
import { seCreate, seSign, findSignerBinary } from "./se-bridge.js";

const RootKeyHandleSchema = z.object({
  keyRef: z.string(),
  publicKey: z.string(),
  policy: KeyPolicySchema,
  platform: PlatformCapabilitySchema,
  createdAt: z.string(),
});

const ROOT_KEY_REF = "root-key-ref";
const ROOT_KEY_PRIVATE = "root-key:private";

/** Result of root key initialization: opaque handle only. */
export type RootKeyResult = RootKeyHandle;

/**
 * Initialize or load the root key.
 * Dispatches to Secure Enclave or software vault based on platform.
 */
export async function initializeRootKey(
  vault: Vault,
  policy: KeyPolicy,
  platform: PlatformCapability,
): Promise<Result<RootKeyResult, InternalError>> {
  // Check if root key already exists in vault
  const existing = await vault.get(ROOT_KEY_REF);
  if (Result.isError(existing)) {
    if (existing.error._tag !== "NotFoundError") {
      return Result.err(existing.error);
    }
  } else {
    try {
      const parsed = RootKeyHandleSchema.safeParse(
        JSON.parse(new TextDecoder().decode(existing.value)),
      );
      if (!parsed.success) {
        return Result.err(
          InternalError.create("Invalid root key handle data", {
            cause: parsed.error.message,
          }),
        );
      }
      const stored: RootKeyHandle = parsed.data;
      return Result.ok(stored);
    } catch (e) {
      return Result.err(
        InternalError.create("Corrupt root key data", {
          cause: String(e),
        }),
      );
    }
  }

  // Dispatch to platform-specific initialization
  if (platform === "secure-enclave") {
    return initializeRootKeySE(vault, policy);
  }

  return initializeRootKeySoftware(vault, policy, platform);
}

/** Initialize root key via Secure Enclave subprocess. */
async function initializeRootKeySE(
  vault: Vault,
  policy: KeyPolicy,
): Promise<Result<RootKeyResult, InternalError>> {
  const signerPath = findSignerBinary();
  if (!signerPath) {
    return Result.err(
      InternalError.create(
        "signet-signer binary not found — cannot create SE key",
      ),
    );
  }

  const label = `signet-root-${Date.now()}`;
  const createResult = await seCreate(label, policy, signerPath);
  if (Result.isError(createResult)) return createResult;

  const { keyRef, publicKey } = createResult.value;

  const handle: RootKeyHandle = {
    keyRef,
    publicKey,
    policy,
    platform: "secure-enclave",
    createdAt: new Date().toISOString(),
  };

  // Store handle metadata in vault (no private material — keyRef is the opaque SE token)
  const storeResult = await vault.set(
    ROOT_KEY_REF,
    new TextEncoder().encode(JSON.stringify(handle)),
  );
  if (Result.isError(storeResult)) return storeResult;

  return Result.ok(handle);
}

/** Initialize root key via software P-256 (existing behavior). */
async function initializeRootKeySoftware(
  vault: Vault,
  policy: KeyPolicy,
  platform: PlatformCapability,
): Promise<Result<RootKeyResult, InternalError>> {
  const keyPair = await generateP256KeyPair();
  if (Result.isError(keyPair)) return keyPair;

  const pubBytes = await exportPublicKey(keyPair.value.publicKey);
  if (Result.isError(pubBytes)) return pubBytes;

  const privBytes = await exportPrivateKey(keyPair.value.privateKey);
  if (Result.isError(privBytes)) return privBytes;

  const storePrivateResult = await vault.set(ROOT_KEY_PRIVATE, privBytes.value);
  if (Result.isError(storePrivateResult)) return storePrivateResult;

  // Zeroize exported private key bytes after vault storage
  privBytes.value.fill(0);

  const keyRef = crypto.randomUUID();
  const handle: RootKeyHandle = {
    keyRef,
    publicKey: toHex(pubBytes.value),
    policy,
    platform,
    createdAt: new Date().toISOString(),
  };

  const storeResult = await vault.set(
    ROOT_KEY_REF,
    new TextEncoder().encode(JSON.stringify(handle)),
  );
  if (Result.isError(storeResult)) return storeResult;

  return Result.ok(handle);
}

/**
 * Sign data with the root key. Dispatches based on the platform stored
 * in the root key handle metadata.
 */
export async function signWithRootKey(
  vault: Vault,
  data: Uint8Array,
): Promise<Result<Uint8Array, InternalError>> {
  // Load handle to determine platform
  const handleBytes = await vault.get(ROOT_KEY_REF);
  if (Result.isError(handleBytes)) {
    return Result.err(
      InternalError.create("Root key handle not found in vault"),
    );
  }

  let handle: RootKeyHandle;
  try {
    const parsed = RootKeyHandleSchema.safeParse(
      JSON.parse(new TextDecoder().decode(handleBytes.value)),
    );
    if (!parsed.success) {
      return Result.err(
        InternalError.create("Invalid root key handle data", {
          cause: parsed.error.message,
        }),
      );
    }
    handle = parsed.data;
  } catch (e) {
    return Result.err(
      InternalError.create("Corrupt root key data", { cause: String(e) }),
    );
  }

  if (handle.platform === "secure-enclave") {
    return signWithRootKeySE(handle.keyRef, data);
  }

  return signWithRootKeySoftware(vault, data);
}

/** Sign via Secure Enclave subprocess. */
async function signWithRootKeySE(
  keyRef: string,
  data: Uint8Array,
): Promise<Result<Uint8Array, InternalError>> {
  const signerPath = findSignerBinary();
  if (!signerPath) {
    return Result.err(
      InternalError.create(
        "signet-signer binary not found — cannot sign with SE key",
      ),
    );
  }

  const signResult = await seSign(keyRef, data, signerPath);
  if (Result.isError(signResult)) return signResult;

  // Convert hex DER signature to raw (r || s) format to match WebCrypto output
  const hex = signResult.value.signature;
  const derBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    derBytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  const bytes = derToRaw(derBytes);

  return Result.ok(bytes);
}

/** Sign via software key loaded from vault (existing behavior). */
async function signWithRootKeySoftware(
  vault: Vault,
  data: Uint8Array,
): Promise<Result<Uint8Array, InternalError>> {
  const privateBytes = await vault.get(ROOT_KEY_PRIVATE);
  if (Result.isError(privateBytes)) {
    return Result.err(
      InternalError.create("Root key private material not found in vault"),
    );
  }

  const imported = await importP256PrivateKey(privateBytes.value);
  if (Result.isError(imported)) return imported;

  return signP256(imported.value, data);
}
