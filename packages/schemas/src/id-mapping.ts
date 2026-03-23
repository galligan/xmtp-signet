import { z } from "zod";
import {
  NetworkId,
  MessageId,
  ConversationId,
  InboxId,
} from "./resource-id.js";

/**
 * Resource types that support bidirectional ID mapping between
 * XMTP network identifiers and local signet resource IDs.
 */
export const IdMappingResourceType: z.ZodEnum<
  ["message", "conversation", "inbox"]
> = z.enum(["message", "conversation", "inbox"]);

/** Inferred union of mappable resource type strings. */
export type IdMappingResourceTypeType = z.infer<typeof IdMappingResourceType>;

// -- Types (declared first for isolatedDeclarations) -----------------------

/** Validated ID mapping between a network ID and a local resource ID. */
export type IdMappingType = {
  networkId: string;
  localId: string;
  resourceType: IdMappingResourceTypeType;
  createdAt: string;
};

// -- Schemas ---------------------------------------------------------------

/**
 * A bidirectional mapping between an XMTP network ID (`xmtp_` prefix)
 * and a local signet resource ID (e.g. `msg_`, `conv_`, `inbox_`).
 */
export const IdMapping: z.ZodType<IdMappingType> = z.object({
  /** The XMTP network-assigned identifier. */
  networkId: NetworkId,
  /** The local signet resource identifier. */
  localId: z.string(),
  /** Which resource type this mapping represents. */
  resourceType: IdMappingResourceType,
  /** ISO 8601 timestamp when the mapping was created. */
  createdAt: z.string().datetime(),
}).superRefine((value, ctx) => {
  const schemaByType = {
    message: MessageId,
    conversation: ConversationId,
    inbox: InboxId,
  } as const;

  const localIdSchema = schemaByType[value.resourceType];
  if (!localIdSchema.safeParse(value.localId).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["localId"],
      message: `localId must be a valid ${value.resourceType} resource ID`,
    });
  }
});

/**
 * Runtime contract for a bidirectional ID mapping store.
 *
 * Implementations translate between XMTP network IDs and local
 * signet resource IDs. The store is not a Zod schema — it defines
 * the interface that concrete storage backends must satisfy.
 */
export interface IdMappingStore {
  /** Store a bidirectional mapping between a network ID and a local ID. */
  set(
    networkId: string,
    localId: string,
    resourceType: IdMappingResourceTypeType,
  ): void;

  /** Resolve a network ID to its local ID. Returns null if not found. */
  getLocal(networkId: string): string | null;

  /** Resolve a local ID to its network ID. Returns null if not found. */
  getNetwork(localId: string): string | null;

  /** Resolve any ID (network or local) to both IDs. Returns null if not found. */
  resolve(id: string): { networkId: string; localId: string } | null;
}
