import type { ContentTypeId, MessageEvent } from "@xmtp/signet-schemas";

/**
 * A raw message as received from the XMTP client, already decoded.
 * Extends the contracts RawMessage with threadId and sealId
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
  readonly sealId: string | null;
  /** True if received during broker recovery sync. Defaults to false. */
  readonly isHistorical?: boolean;
}

/** Result of projecting a raw message through the view pipeline. */
export type ProjectionResult =
  | { readonly action: "emit"; readonly event: MessageEvent }
  | { readonly action: "drop" };

/** Signet-level content type configuration. */
export interface SignetContentTypeConfig {
  readonly allowlist: ReadonlySet<ContentTypeId>;
}
