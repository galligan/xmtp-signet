import type { KeyPolicy, PlatformCapability } from "./config.js";

/** Opaque handle to the root key. Never contains raw key bytes. */
export interface RootKeyHandle {
  readonly keyRef: string;
  readonly publicKey: string;
  readonly policy: KeyPolicy;
  readonly platform: PlatformCapability;
  readonly createdAt: string;
}

/** Ed25519 operational key for an agent identity. */
export interface OperationalKey {
  readonly keyId: string;
  readonly identityId: string;
  readonly groupId: string | null;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly rotatedAt: string | null;
}

/** Ephemeral session key, in-memory only. */
export interface SessionKey {
  readonly keyId: string;
  readonly sessionId: string;
  readonly fingerprint: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}
