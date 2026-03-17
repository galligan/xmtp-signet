import type { Result } from "better-result";
import type {
  Seal,
  SignetError,
  RevealGrant,
  RevealState,
  RevocationSeal,
} from "@xmtp/signet-schemas";
import type {
  SealEnvelope,
  SignedRevocationEnvelope,
} from "./seal-envelope.js";

/** Abstracts key material for signing and identity-scoped encryption. */
export interface SignerProvider {
  sign(data: Uint8Array): Promise<Result<Uint8Array, SignetError>>;
  getPublicKey(): Promise<Result<Uint8Array, SignetError>>;
  getFingerprint(): Promise<Result<string, SignetError>>;
  /** Derive a deterministic DB encryption key for the bound identity. */
  getDbEncryptionKey(): Promise<Result<Uint8Array, SignetError>>;
  /**
   * Retrieve the secp256k1 private key for XMTP identity registration.
   * Returns a hex-encoded 0x-prefixed key.
   */
  getXmtpIdentityKey(): Promise<Result<`0x${string}`, SignetError>>;
}

/** Signs seal payloads. */
export interface SealStamper {
  sign(payload: Seal): Promise<Result<SealEnvelope, SignetError>>;
  signRevocation(
    payload: RevocationSeal,
  ): Promise<Result<SignedRevocationEnvelope, SignetError>>;
}

/** Publishes signed seals to groups. */
export interface SealPublisher {
  publish(
    groupId: string,
    seal: SealEnvelope,
  ): Promise<Result<void, SignetError>>;
  publishRevocation(
    groupId: string,
    revocation: SignedRevocationEnvelope,
  ): Promise<Result<void, SignetError>>;
}

/** Persists and queries reveal grant state. */
export interface RevealStateStore {
  grant(revealGrant: RevealGrant): Promise<Result<void, SignetError>>;
  revoke(revealId: string): Promise<Result<void, SignetError>>;
  activeReveals(sessionId: string): Promise<Result<RevealState, SignetError>>;
  isRevealed(
    sessionId: string,
    messageId: string,
  ): Promise<Result<boolean, SignetError>>;
}
