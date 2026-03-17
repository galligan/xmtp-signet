import type { Result } from "better-result";
import type {
  Attestation,
  BrokerError,
  RevealGrant,
  RevealState,
  RevocationAttestation,
} from "@xmtp-broker/schemas";
import type {
  SignedAttestation,
  SignedRevocationEnvelope,
} from "./attestation-types.js";

/** Abstracts key material for signing and identity-scoped encryption. */
export interface SignerProvider {
  sign(data: Uint8Array): Promise<Result<Uint8Array, BrokerError>>;
  getPublicKey(): Promise<Result<Uint8Array, BrokerError>>;
  getFingerprint(): Promise<Result<string, BrokerError>>;
  /** Derive a deterministic DB encryption key for the bound identity. */
  getDbEncryptionKey(): Promise<Result<Uint8Array, BrokerError>>;
  /**
   * Retrieve the secp256k1 private key for XMTP identity registration.
   * Returns a hex-encoded 0x-prefixed key.
   */
  getXmtpIdentityKey(): Promise<Result<`0x${string}`, BrokerError>>;
}

/** Signs attestation payloads. */
export interface AttestationSigner {
  sign(payload: Attestation): Promise<Result<SignedAttestation, BrokerError>>;
  signRevocation(
    payload: RevocationAttestation,
  ): Promise<Result<SignedRevocationEnvelope, BrokerError>>;
}

/** Publishes signed attestations to groups. */
export interface AttestationPublisher {
  publish(
    groupId: string,
    attestation: SignedAttestation,
  ): Promise<Result<void, BrokerError>>;
  publishRevocation(
    groupId: string,
    revocation: SignedRevocationEnvelope,
  ): Promise<Result<void, BrokerError>>;
}

/** Persists and queries reveal grant state. */
export interface RevealStateStore {
  grant(revealGrant: RevealGrant): Promise<Result<void, BrokerError>>;
  revoke(revealId: string): Promise<Result<void, BrokerError>>;
  activeReveals(sessionId: string): Promise<Result<RevealState, BrokerError>>;
  isRevealed(
    sessionId: string,
    messageId: string,
  ): Promise<Result<boolean, BrokerError>>;
}
