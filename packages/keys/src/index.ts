// Config and schemas
export {
  KeyPolicySchema,
  PlatformCapabilitySchema,
  KeyManagerConfigSchema,
} from "./config.js";
export type {
  KeyPolicy,
  PlatformCapability,
  KeyManagerConfig,
} from "./config.js";

// Types
export type { RootKeyHandle, OperationalKey, SessionKey } from "./types.js";

// Platform detection
export {
  detectPlatform,
  platformToTrustTier,
  resetPlatformCache,
} from "./platform.js";

// Secure Enclave bridge
export {
  findSignerBinary,
  seCreate,
  seSign,
  seInfo,
  seDelete,
} from "./se-bridge.js";
export type {
  SeCreateResponse,
  SeSignResponse,
  SeSystemInfoResponse,
  SeKeyInfoResponse,
} from "./se-protocol.js";

// Key manager
export { createKeyManager } from "./key-manager.js";
export type { KeyManager } from "./key-manager.js";

// Vault
export { createVault } from "./vault.js";
export type { Vault } from "./vault.js";

// Signer provider
export { createSignerProvider } from "./signer-provider.js";

// Seal stamper
export { createSealStamper } from "./seal-stamper.js";

// Operational key manager
export { createOperationalKeyManager } from "./operational-key.js";
export type { OperationalKeyManager } from "./operational-key.js";

// Session key manager
export { createSessionKeyManager } from "./session-key.js";
export type { SessionKeyManager } from "./session-key.js";

// Admin key manager
export { createAdminKeyManager } from "./admin-key.js";
export type {
  AdminKeyManager,
  AdminKeyRecord,
  AdminAuthContext,
  AdminAuthMethod,
  AdminJwtOptions,
} from "./admin-key.js";

// JWT utilities
export {
  AdminJwtConfigSchema,
  AdminJwtPayloadSchema,
  base64urlEncode,
  base64urlDecode,
} from "./jwt.js";
export type { AdminJwtConfig, AdminJwtPayload } from "./jwt.js";

// Root key
export { initializeRootKey, signWithRootKey } from "./root-key.js";
export type { RootKeyResult } from "./root-key.js";

// Crypto utilities
export {
  generateP256KeyPair,
  generateEd25519KeyPair,
  signP256,
  verifyP256,
  signEd25519,
  verifyEd25519,
  exportPublicKey,
  exportPrivateKey,
  importEd25519PrivateKey,
  importP256PrivateKey,
  fingerprint,
  toHex,
} from "./crypto-keys.js";
