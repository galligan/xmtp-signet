import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type {
  SealPayloadType,
  SealEnvelopeType,
  SignetError,
} from "@xmtp/signet-schemas";
import type { RevocationSeal } from "@xmtp/signet-schemas";
import type {
  SealStamper,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import { canonicalize } from "./canonicalize.js";

/** Opaque handle to a signing key -- hides key material from callers. */
export interface SigningKeyHandle {
  /** Sign arbitrary bytes and return the raw signature. */
  sign(data: Uint8Array): Promise<Uint8Array>;
  /** Current fingerprint of the key. Method so it survives key rotation. */
  fingerprint(): string;
}

/** Dependencies for creating a SealStamper. */
export interface StamperDeps {
  /** The signing key this stamper will use for all operations. */
  readonly signingKey: SigningKeyHandle;
}

/** Check if a value is a structured SignetError (has _tag and category). */
function isSignetError(e: unknown): e is SignetError {
  return (
    e instanceof Error &&
    "_tag" in e &&
    typeof (e as Record<string, unknown>)["_tag"] === "string" &&
    "category" in e &&
    typeof (e as Record<string, unknown>)["category"] === "string"
  );
}

/**
 * Creates a `SealStamper` backed by a single `SigningKeyHandle`.
 *
 * The stamper canonicalizes the payload, signs the bytes, and wraps
 * the result in a `SealEnvelopeType` / `SignedRevocationEnvelope`.
 */
export function createSealStamper(deps: StamperDeps): SealStamper {
  const { signingKey } = deps;

  async function signBytes(
    payload: unknown,
  ): Promise<Result<string, SignetError>> {
    try {
      const bytes = canonicalize(payload);
      const signature = await signingKey.sign(bytes);
      const base64 = btoa(String.fromCharCode(...signature));
      return Result.ok(base64);
    } catch (e) {
      if (isSignetError(e)) {
        return Result.err(e);
      }
      return Result.err(
        InternalError.create("Seal signing failed", {
          cause: String(e),
        }),
      );
    }
  }

  return {
    async sign(
      payload: SealPayloadType,
    ): Promise<Result<SealEnvelopeType, SignetError>> {
      const sigResult = await signBytes(payload);
      if (Result.isError(sigResult)) return sigResult;

      return Result.ok({
        chain: {
          current: payload,
          delta: { added: [], removed: [], changed: [] },
        },
        signature: sigResult.value,
        keyId: signingKey.fingerprint(),
        algorithm: "Ed25519",
      });
    },

    async signRevocation(
      payload: RevocationSeal,
    ): Promise<Result<SignedRevocationEnvelope, SignetError>> {
      const sigResult = await signBytes(payload);
      if (Result.isError(sigResult)) return sigResult;

      return Result.ok({
        revocation: payload,
        signature: sigResult.value,
        signatureAlgorithm: "Ed25519",
        signerKeyRef: signingKey.fingerprint(),
      });
    },
  };
}
