import { Result } from "better-result";
import type { MessageSealBindingType, SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import { canonicalize } from "./canonicalize.js";

/** Callback to sign data with the credential's Ed25519 key. */
export type BindingSigner = (
  data: Uint8Array,
) => Promise<Result<Uint8Array, SignetError>>;

/** Callback to verify a signature against the credential's public key. */
export type BindingVerifier = (
  data: Uint8Array,
  signature: Uint8Array,
) => Promise<Result<boolean, SignetError>>;

/**
 * Creates a message-seal binding by signing the canonical representation
 * of `{ messageId, sealId }` with the credential's Ed25519 key.
 *
 * The binding proves that the holder of the credential key authorized
 * the association between a specific message and seal.
 */
export async function createMessageBinding(
  messageId: string,
  sealId: string,
  sign: BindingSigner,
): Promise<Result<MessageSealBindingType, SignetError>> {
  const payload = canonicalize({ messageId, sealId });
  const sigResult = await sign(payload);
  if (Result.isError(sigResult)) return sigResult;

  return Result.ok({
    sealRef: sealId,
    sealSignature: btoa(String.fromCharCode(...sigResult.value)),
  });
}

/**
 * Verifies a message-seal binding against the credential's public key.
 *
 * Reconstructs the canonical payload from the binding's `sealRef` and
 * the provided `messageId`, then checks the signature.
 */
export async function verifyMessageBinding(
  binding: MessageSealBindingType,
  messageId: string,
  verify: BindingVerifier,
): Promise<Result<boolean, SignetError>> {
  const payload = canonicalize({ messageId, sealId: binding.sealRef });
  let sigBytes: Uint8Array;
  try {
    sigBytes = Uint8Array.from(atob(binding.sealSignature), (c) =>
      c.charCodeAt(0),
    );
  } catch (e) {
    return Result.err(
      InternalError.create("Invalid message binding signature encoding", {
        cause: String(e),
      }),
    );
  }
  return verify(payload, sigBytes);
}
