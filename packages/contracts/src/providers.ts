import type { Result } from "better-result";
import type {
  Seal,
  SignetError,
  ContentTypeId,
  RevealGrant,
  RevealRequest,
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

/** Serializable reveal entry that preserves request context for restore. */
export interface RevealStateEntry {
  readonly grant: RevealGrant;
  readonly request: RevealRequest;
}

/** Snapshot format for the reveal state store. */
export interface RevealStateSnapshot {
  readonly activeReveals: readonly RevealStateEntry[];
}

/**
 * In-memory reveal state store scoped to an agent session.
 * The policy engine owns the matching logic; the session manager
 * owns the lifecycle (create, cleanup on revoke/expire).
 */
export interface RevealStateStore {
  /** Add a reveal grant with its originating request. */
  grant(reveal: RevealGrant, request: RevealRequest): void;

  /** Check if a specific message is revealed by any active grant. */
  isRevealed(
    messageId: string,
    groupId: string,
    threadId: string | null,
    senderInboxId: string,
    contentType: ContentTypeId,
    sentAt: string,
  ): boolean;

  /** Remove expired reveals. Returns count of removed grants. */
  expireStale(now: Date): number;

  /** Snapshot the current state for serialization. */
  snapshot(): RevealStateSnapshot;

  /** Restore from a serialized snapshot. */
  restore(state: RevealStateSnapshot): void;
}
