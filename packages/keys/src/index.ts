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

// Types for the key-manager adapter surface used by runtime adapters/tests.
export type { RootKeyHandle, OperationalKey, CredentialKey } from "./types.js";

// KeyManager adapter surface used by runtime wiring and tests.
export { createKeyManager } from "./key-manager-compat.js";
export type { KeyManager, AdminKeyManager } from "./key-manager-compat.js";

// Key backend interface (v1)
export type {
  KeyBackend,
  WalletProvider,
  WalletInfo,
  AccountInfo,
  SigningResult,
  ApiKeyInfo,
} from "./key-backend.js";

// Key backend implementation (v1)
export { createInternalKeyBackend } from "./key-manager.js";

// Platform detection
export {
  detectPlatform,
  platformToTrustTier,
  resetPlatformCache,
} from "./platform.js";
export type { KeyTrustTier } from "./platform.js";
export type { TrustTier } from "./platform.js";

// Secure Enclave bridge
export {
  findSignerBinary,
  seCreate,
  seSign,
  seEncrypt,
  seDecrypt,
  seInfo,
  seDelete,
} from "./se-bridge.js";
export type {
  SeCreateResponse,
  SeSignResponse,
  SeSystemInfoResponse,
  SeDecryptResponse,
  SeKeyInfoResponse,
  SealedBox,
} from "./se-protocol.js";

// Vault
export { createVault } from "./vault.js";
export type {
  Vault,
  WalletFileInfo,
  AccountEntry,
  CreateVaultOptions,
} from "./vault.js";

// Signer provider
export { createSignerProvider } from "./signer-provider.js";

// Seal stamper
export { createSealStamper } from "./seal-stamper.js";

// Vault secret providers (SE-backed ECIES and software fallback)
export {
  createSeVaultSecretProvider,
  createSoftwareVaultSecretProvider,
  resolveVaultSecretProvider,
} from "./vault-secret-provider.js";
export type { VaultSecretProvider } from "./vault-secret-provider.js";

// SE-backed biometric gate prompter
export {
  createSeGatePrompter,
  resolveGatePrompter,
} from "./se-gate-prompter.js";

// Biometric gate
export {
  createBiometricGate,
  BiometricGateConfigSchema,
} from "./biometric-gate.js";
export type {
  BiometricGateConfig,
  BiometricGateConfigInput,
  GatedOperation,
  BiometricPrompter,
} from "./biometric-gate.js";

// JWT utilities
export {
  AdminJwtConfigSchema,
  AdminJwtPayloadSchema,
  base64urlEncode,
  base64urlDecode,
} from "./jwt.js";
export type { AdminJwtConfig, AdminJwtPayload } from "./jwt.js";

// Derivation (BIP-39/BIP-44)
export {
  generateMnemonic,
  mnemonicToSeed,
  derivePath,
  deriveEvmKey,
  deriveEd25519Key,
  EVM_PATH_PREFIX,
  ED25519_PATH_PREFIX,
} from "./derivation.js";
export type {
  DerivedKey,
  DerivedEvmKey,
  DerivedEd25519Key,
} from "./derivation.js";

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
