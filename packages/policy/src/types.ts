import type { ContentTypeId, MessageEvent } from "@xmtp-broker/schemas";

/**
 * A raw message as received from the XMTP client, already decoded.
 * Extends the contracts RawMessage with threadId and attestationId
 * needed by the policy pipeline.
 */
export interface RawMessage {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: ContentTypeId;
  readonly content: unknown;
  readonly sentAt: string;
  readonly threadId: string | null;
  readonly attestationId: string | null;
}

/** Result of projecting a raw message through the view pipeline. */
export type ProjectionResult =
  | { readonly action: "emit"; readonly event: MessageEvent }
  | { readonly action: "drop" };

/** Broker-level content type configuration. */
export interface BrokerContentTypeConfig {
  readonly allowlist: ReadonlySet<ContentTypeId>;
}
