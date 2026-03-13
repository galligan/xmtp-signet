import { z } from "zod";
import { Result } from "better-result";
import { InternalError } from "@xmtp-broker/schemas";
import {
  KeyPolicySchema,
  PlatformCapabilitySchema,
} from "./config.js";
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
 * v0: software P-256 key stored in the vault.
 * Future: Secure Enclave via Swift subprocess.
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

  // Generate new root key
  const keyPair = await generateP256KeyPair();
  if (Result.isError(keyPair)) return keyPair;

  const pubBytes = await exportPublicKey(keyPair.value.publicKey);
  if (Result.isError(pubBytes)) return pubBytes;

  // Export and store the private key
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

  // Store root key handle metadata in vault
  const storeResult = await vault.set(
    ROOT_KEY_REF,
    new TextEncoder().encode(JSON.stringify(handle)),
  );
  if (Result.isError(storeResult)) return storeResult;

  return Result.ok(handle);
}

/**
 * Sign data with the root key. Loads private material from vault on-demand,
 * signs, then lets the CryptoKey be garbage collected.
 */
export async function signWithRootKey(
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
