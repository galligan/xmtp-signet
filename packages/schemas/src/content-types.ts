import { z } from "zod";

/**
 * XMTP content type identifier following the authority/type:version convention.
 * Examples: "xmtp.org/text:1.0", "xmtp.org/reaction:1.0"
 */
export const ContentTypeId: z.ZodString = z
  .string()
  .regex(/^[a-z0-9.-]+\/[a-zA-Z0-9]+:\d+\.\d+$/)
  .describe("XMTP content type identifier (authority/type:version)");

/** Standard XMTP content type identifier string. */
export type ContentTypeId = z.infer<typeof ContentTypeId>;

/** Baseline XMTP content types accepted without extra policy configuration. */
export const BASELINE_CONTENT_TYPES: readonly [
  "xmtp.org/text:1.0",
  "xmtp.org/reaction:1.0",
  "xmtp.org/reply:1.0",
  "xmtp.org/readReceipt:1.0",
  "xmtp.org/groupUpdated:1.0",
] = [
  "xmtp.org/text:1.0",
  "xmtp.org/reaction:1.0",
  "xmtp.org/reply:1.0",
  "xmtp.org/readReceipt:1.0",
  "xmtp.org/groupUpdated:1.0",
] as const;

/** Union of the baseline XMTP content types. */
export type BaselineContentType = (typeof BASELINE_CONTENT_TYPES)[number];

/** Text payload carried by `xmtp.org/text:1.0`. */
export type TextPayload = {
  text: string;
};

/** Zod schema for a plain text XMTP message payload. */
export const TextPayload: z.ZodType<TextPayload> = z
  .object({
    text: z.string().min(1).describe("Message text content"),
  })
  .describe("Text message payload");

/** Reaction payload carried by `xmtp.org/reaction:1.0`. */
export type ReactionPayload = {
  reference: string;
  action: "added" | "removed";
  content: string;
  schema: "unicode" | "shortcode" | "custom";
};

/** Zod schema for an XMTP reaction payload. */
export const ReactionPayload: z.ZodType<ReactionPayload> = z
  .object({
    reference: z.string().describe("Message ID being reacted to"),
    action: z
      .enum(["added", "removed"])
      .describe("Whether reaction is added or removed"),
    content: z.string().describe("Reaction content (emoji or text)"),
    schema: z
      .enum(["unicode", "shortcode", "custom"])
      .describe("Reaction schema type"),
  })
  .describe("Reaction payload");

/** Reply payload carried by `xmtp.org/reply:1.0`. */
export type ReplyPayload = {
  reference: string;
  content: {
    type: string;
    payload?: unknown;
  };
};

/** Zod schema for an XMTP reply payload. */
export const ReplyPayload: z.ZodType<ReplyPayload> = z
  .object({
    reference: z.string().describe("Message ID being replied to"),
    content: z
      .object({
        type: ContentTypeId.describe("Content type of the reply body"),
        payload: z.unknown().describe("Encoded reply content"),
      })
      .describe("Reply body"),
  })
  .describe("Reply payload");

/** Empty payload carried by `xmtp.org/readReceipt:1.0`. */
export type ReadReceiptPayload = Record<string, never>;

/** Zod schema for an XMTP read-receipt payload. */
export const ReadReceiptPayload: z.ZodType<ReadReceiptPayload> = z
  .object({})
  .describe("Read receipt payload (empty body)");

/** Group membership and metadata update payload carried by `xmtp.org/groupUpdated:1.0`. */
export type GroupUpdatedPayload = {
  initiatedByInboxId: string;
  addedInboxes: string[];
  removedInboxes: string[];
  metadataFieldsChanged: {
    fieldName: string;
    oldValue: string | null;
    newValue: string | null;
  }[];
};

/** Zod schema for XMTP group membership and metadata update payloads. */
export const GroupUpdatedPayload: z.ZodType<GroupUpdatedPayload> = z
  .object({
    initiatedByInboxId: z
      .string()
      .describe("Inbox ID of the member who initiated the update"),
    addedInboxes: z.array(z.string()).describe("Inbox IDs added to the group"),
    removedInboxes: z
      .array(z.string())
      .describe("Inbox IDs removed from the group"),
    metadataFieldsChanged: z
      .array(
        z.object({
          fieldName: z.string().describe("Name of the changed metadata field"),
          oldValue: z.string().nullable().describe("Previous value"),
          newValue: z.string().nullable().describe("New value"),
        }),
      )
      .describe("Metadata fields that changed"),
  })
  .describe("Group membership/metadata update payload");

/** Map from content type ID to its payload schema. Extensible at runtime. */
export const CONTENT_TYPE_SCHEMAS: {
  readonly "xmtp.org/text:1.0": z.ZodType<TextPayload>;
  readonly "xmtp.org/reaction:1.0": z.ZodType<ReactionPayload>;
  readonly "xmtp.org/reply:1.0": z.ZodType<ReplyPayload>;
  readonly "xmtp.org/readReceipt:1.0": z.ZodType<ReadReceiptPayload>;
  readonly "xmtp.org/groupUpdated:1.0": z.ZodType<GroupUpdatedPayload>;
} = {
  "xmtp.org/text:1.0": TextPayload,
  "xmtp.org/reaction:1.0": ReactionPayload,
  "xmtp.org/reply:1.0": ReplyPayload,
  "xmtp.org/readReceipt:1.0": ReadReceiptPayload,
  "xmtp.org/groupUpdated:1.0": GroupUpdatedPayload,
} as const satisfies Partial<Record<string, z.ZodType>>;
