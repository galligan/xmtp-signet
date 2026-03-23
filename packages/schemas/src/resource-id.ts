import crypto from "node:crypto";
import { z } from "zod";
import { Result } from "better-result";
import { ValidationError, NotFoundError } from "./errors/index.js";

/**
 * Prefix strings for each resource type. Keys are the canonical
 * resource type names used throughout the system.
 */
export const RESOURCE_PREFIXES: {
  readonly operator: "op_";
  readonly inbox: "inbox_";
  readonly conversation: "conv_";
  readonly policy: "policy_";
  readonly credential: "cred_";
  readonly seal: "seal_";
  readonly key: "key_";
  readonly message: "msg_";
  readonly network: "xmtp_";
} = {
  operator: "op_",
  inbox: "inbox_",
  conversation: "conv_",
  policy: "policy_",
  credential: "cred_",
  seal: "seal_",
  key: "key_",
  message: "msg_",
  network: "xmtp_",
};

/** Zod enum of all resource type names. */
export const ResourceType: z.ZodEnum<
  [
    "operator",
    "inbox",
    "conversation",
    "policy",
    "credential",
    "seal",
    "key",
    "message",
    "network",
  ]
> = z.enum([
  "operator",
  "inbox",
  "conversation",
  "policy",
  "credential",
  "seal",
  "key",
  "message",
  "network",
]);

/** Inferred union of resource type name strings. */
export type ResourceType = z.infer<typeof ResourceType>;

type PrefixValue = (typeof RESOURCE_PREFIXES)[ResourceType];

// Reverse lookup: prefix string -> resource type name
const PREFIX_TO_TYPE = Object.fromEntries(
  Object.entries(RESOURCE_PREFIXES).map(([k, v]) => [v, k]),
) as Record<PrefixValue, ResourceType>;

const ALL_PREFIXES = Object.values(RESOURCE_PREFIXES) as PrefixValue[];
/** Canonical hex suffix length for generated local resource IDs. */
export const RESOURCE_ID_HEX_LENGTH = 16;
const SHORT_ID_HEX = new RegExp(
  `^[0-9a-f]{${RESOURCE_ID_HEX_LENGTH}}$`,
);

function createResourceIdSchema(prefix: PrefixValue): z.ZodType<string> {
  return z.string().refine((value) => {
    if (!value.startsWith(prefix)) {
      return false;
    }
    return SHORT_ID_HEX.test(value.slice(prefix.length));
  }, `Must start with "${prefix}" followed by ${RESOURCE_ID_HEX_LENGTH} lowercase hex characters`);
}

// -- Per-resource Zod schemas ----------------------------------------

/** Schema for operator resource IDs (`op_` prefix). */
export const OperatorId: z.ZodType<string> = createResourceIdSchema("op_");

/** Branded TypeScript type for operator resource IDs. */
export type OperatorIdType = z.infer<typeof OperatorId>;

/** Schema for inbox resource IDs (`inbox_` prefix). */
export const InboxId: z.ZodType<string> = createResourceIdSchema("inbox_");

/** Branded TypeScript type for inbox resource IDs. */
export type InboxIdType = z.infer<typeof InboxId>;

/** Schema for conversation resource IDs (`conv_` prefix). */
export const ConversationId: z.ZodType<string> = createResourceIdSchema("conv_");

/** Branded TypeScript type for conversation resource IDs. */
export type ConversationIdType = z.infer<typeof ConversationId>;

/** Schema for policy resource IDs (`policy_` prefix). */
export const PolicyId: z.ZodType<string> = createResourceIdSchema("policy_");

/** Branded TypeScript type for policy resource IDs. */
export type PolicyIdType = z.infer<typeof PolicyId>;

/** Schema for credential resource IDs (`cred_` prefix). */
export const CredentialId: z.ZodType<string> = createResourceIdSchema("cred_");

/** Branded TypeScript type for credential resource IDs. */
export type CredentialIdType = z.infer<typeof CredentialId>;

/** Schema for seal resource IDs (`seal_` prefix). */
export const SealId: z.ZodType<string> = createResourceIdSchema("seal_");

/** Branded TypeScript type for seal resource IDs. */
export type SealIdType = z.infer<typeof SealId>;

/** Schema for key resource IDs (`key_` prefix). */
export const KeyId: z.ZodType<string> = createResourceIdSchema("key_");

/** Branded TypeScript type for key resource IDs. */
export type KeyIdType = z.infer<typeof KeyId>;

/** Schema for message resource IDs (`msg_` prefix). */
export const MessageId: z.ZodType<string> = createResourceIdSchema("msg_");

/** Branded TypeScript type for message resource IDs. */
export type MessageIdType = z.infer<typeof MessageId>;

/** Schema for network resource IDs (`xmtp_` prefix). */
export const NetworkId: z.ZodType<string> = createResourceIdSchema("xmtp_");

/** Branded TypeScript type for network resource IDs. */
export type NetworkIdType = z.infer<typeof NetworkId>;

/** Union schema accepting any valid prefixed resource ID. */
export const AnyResourceId: z.ZodType<string> = z.union([
  OperatorId,
  InboxId,
  ConversationId,
  PolicyId,
  CredentialId,
  SealId,
  KeyId,
  MessageId,
  NetworkId,
]);

// -- Factory & parsing -----------------------------------------------

/**
 * Creates a new resource ID with the given type prefix and 16
 * random hex characters (8 bytes of entropy).
 */
export function createResourceId(type: ResourceType): string {
  const prefix = RESOURCE_PREFIXES[type];
  const hex = crypto.randomBytes(RESOURCE_ID_HEX_LENGTH / 2).toString("hex");
  return `${prefix}${hex}`;
}

/** Parsed components of a resource ID. */
export interface ParsedResourceId {
  readonly type: ResourceType;
  readonly prefix: string;
  readonly shortId: string;
  readonly fullId: string;
}

/**
 * Parses a prefixed resource ID into its components.
 *
 * @throws {ValidationError} If the prefix or suffix format is invalid.
 */
export function parseResourceId(id: string): ParsedResourceId {
  for (const prefix of ALL_PREFIXES) {
    if (id.startsWith(prefix)) {
      const shortId = id.slice(prefix.length);
      if (!SHORT_ID_HEX.test(shortId)) {
        throw ValidationError.create(
          "resourceId",
          `Resource IDs with prefix "${prefix}" must end with ${RESOURCE_ID_HEX_LENGTH} lowercase hex characters`,
          { id, prefix, shortId },
        );
      }
      return {
        type: PREFIX_TO_TYPE[prefix],
        prefix,
        shortId,
        fullId: id,
      };
    }
  }
  throw ValidationError.create(
    "resourceId",
    `Unrecognized resource ID prefix: "${id}"`,
  );
}

/**
 * Resolves a short hex ID against a list of full resource IDs.
 *
 * Matches by checking whether the hex portion (after the prefix)
 * of each candidate starts with the given short ID.
 *
 * @returns The unique matching full ID, or an error if ambiguous
 *   or not found.
 */
export function resolveShortId(
  shortId: string,
  candidates: readonly string[],
): Result<string, ValidationError | NotFoundError> {
  if (AnyResourceId.safeParse(shortId).success) {
    return candidates.includes(shortId)
      ? Result.ok(shortId)
      : Result.err(NotFoundError.create("resource", shortId));
  }

  let prefix: PrefixValue | undefined;
  let hexPrefix = shortId;
  for (const candidatePrefix of ALL_PREFIXES) {
    if (shortId.startsWith(candidatePrefix)) {
      prefix = candidatePrefix;
      hexPrefix = shortId.slice(candidatePrefix.length);
      break;
    }
  }

  if (hexPrefix.length === 0 || !/^[0-9a-f]+$/.test(hexPrefix)) {
    return Result.err(
      ValidationError.create(
        "shortId",
        "Short ID must be lowercase hex or a full resource ID",
        { shortId },
      ),
    );
  }

  const matches: string[] = [];
  for (const candidate of candidates) {
    if (prefix !== undefined && !candidate.startsWith(prefix)) {
      continue;
    }
    const hex = extractHex(candidate);
    if (hex !== undefined && hex.startsWith(hexPrefix)) {
      matches.push(candidate);
    }
  }

  if (matches.length === 1) {
    // Safe: length check guarantees existence
    const match = matches[0];
    if (match === undefined) {
      return Result.err(NotFoundError.create("resource", shortId));
    }
    return Result.ok(match);
  }

  if (matches.length > 1) {
    return Result.err(
      ValidationError.create("shortId", "Ambiguous short ID", {
        shortId,
        suggestions: matches,
      }),
    );
  }

  return Result.err(NotFoundError.create("resource", shortId));
}

/**
 * Extracts the hex portion after the prefix. Returns undefined
 * for strings with unrecognised prefixes.
 */
function extractHex(id: string): string | undefined {
  for (const prefix of ALL_PREFIXES) {
    if (id.startsWith(prefix)) {
      const hex = id.slice(prefix.length);
      return SHORT_ID_HEX.test(hex) ? hex : undefined;
    }
  }
  return undefined;
}
