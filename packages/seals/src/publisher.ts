import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type {
  SealPublisher,
  SealEnvelope,
  SignedRevocationEnvelope,
} from "@xmtp/signet-contracts";
import {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  encodeSealMessage,
  encodeRevocationMessage,
} from "./content-type.js";

/**
 * Dependencies for creating a SealPublisher.
 * The sendMessage callback is typically backed by SignetCore.sendMessage.
 */
export interface PublisherDeps {
  readonly sendMessage: (
    groupId: string,
    contentType: string,
    content: unknown,
  ) => Promise<Result<{ messageId: string }, SignetError>>;
}

/**
 * Creates a SealPublisher that sends seal envelopes and revocations
 * as XMTP group messages with the appropriate content type.
 */
export function createSealPublisher(deps: PublisherDeps): SealPublisher {
  return {
    async publish(
      groupId: string,
      seal: SealEnvelope,
    ): Promise<Result<void, SignetError>> {
      const encoded = encodeSealMessage(seal);
      const serialized = JSON.stringify(encoded);
      const result = await deps.sendMessage(
        groupId,
        SEAL_CONTENT_TYPE_ID,
        serialized,
      );
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(undefined);
    },

    async publishRevocation(
      groupId: string,
      revocation: SignedRevocationEnvelope,
    ): Promise<Result<void, SignetError>> {
      const encoded = encodeRevocationMessage(revocation);
      const serialized = JSON.stringify(encoded);
      const result = await deps.sendMessage(
        groupId,
        REVOCATION_CONTENT_TYPE_ID,
        serialized,
      );
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok(undefined);
    },
  };
}
