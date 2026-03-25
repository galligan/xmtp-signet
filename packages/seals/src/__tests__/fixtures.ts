import { Result } from "better-result";
import type {
  SealPayloadType,
  SealEnvelopeType,
  SignetError,
  RevocationSeal,
} from "@xmtp/signet-schemas";
import type {
  SealStamper,
  SealPublisher,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import type { SealInput } from "../build.js";
import type { InputResolver } from "../manager.js";
import { canonicalize } from "../canonicalize.js";

/** Creates a valid SealInput for testing. */
export function validInput(overrides?: Partial<SealInput>): SealInput {
  return {
    credentialId: "cred_abcd1234feedbabe",
    operatorId: "op_abcd1234feedbabe",
    chatId: "conv_abcd1234feedbabe",
    scopeMode: "per-chat",
    permissions: {
      allow: ["send", "reply"],
      deny: [],
    },
    ...overrides,
  };
}

/**
 * Creates a mock InputResolver that returns validInput() for any
 * credential+chat pair. Override-able per call via the overrides map.
 */
export function createTestInputResolver(
  overrides?: Map<string, SealInput>,
): InputResolver {
  return async (
    credentialId: string,
    chatId: string,
  ): Promise<Result<SealInput, SignetError>> => {
    const key = `${credentialId}:${chatId}`;
    const input = validInput({
      ...overrides?.get(key),
      credentialId,
      chatId,
    });
    return Result.ok(input);
  };
}

/** Creates a mock SealStamper that produces deterministic signatures. */
export function createTestSigner(): SealStamper {
  return {
    async sign(
      payload: SealPayloadType,
    ): Promise<Result<SealEnvelopeType, SignetError>> {
      const bytes = canonicalize(payload);
      // Simple test signature: base64 of the first 16 bytes of canonical form
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(bytes.slice(0, 16))),
      );
      return Result.ok({
        chain: {
          current: payload,
          delta: { added: [], removed: [], changed: [] },
        },
        signature: sig,
        keyId: "key_feedc0defeedbabe",
        algorithm: "Ed25519",
      });
    },
    async signRevocation(
      payload: RevocationSeal,
    ): Promise<Result<SignedRevocationEnvelope, SignetError>> {
      const bytes = canonicalize(payload);
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(bytes.slice(0, 16))),
      );
      return Result.ok({
        revocation: payload,
        signature: sig,
        signatureAlgorithm: "Ed25519",
        signerKeyRef: "key_test0001",
      });
    },
  };
}

/** Creates a mock SealPublisher that records published seals. */
export function createTestPublisher(): SealPublisher & {
  readonly published: SealEnvelopeType[];
  readonly publishedRevocations: SignedRevocationEnvelope[];
} {
  const published: SealEnvelopeType[] = [];
  const publishedRevocations: SignedRevocationEnvelope[] = [];
  return {
    published,
    publishedRevocations,
    async publish(
      _groupId: string,
      seal: SealEnvelopeType,
    ): Promise<Result<void, SignetError>> {
      published.push(seal);
      return Result.ok();
    },
    async publishRevocation(
      _groupId: string,
      revocation: SignedRevocationEnvelope,
    ): Promise<Result<void, SignetError>> {
      publishedRevocations.push(revocation);
      return Result.ok();
    },
  };
}
