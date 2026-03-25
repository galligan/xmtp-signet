import { z } from "zod";
import {
  OperatorId,
  CredentialId,
  ConversationId,
  InboxId,
  PolicyId,
} from "./resource-id.js";
import { PermissionScope } from "./permission-scopes.js";

/**
 * Lifecycle status of a credential.
 *
 * - `pending` -- issued but not yet activated
 * - `active` -- currently valid and in use
 * - `expired` -- past its TTL
 * - `revoked` -- explicitly revoked by an admin
 */
export const CredentialStatus: z.ZodEnum<
  ["pending", "active", "expired", "revoked"]
> = z.enum(["pending", "active", "expired", "revoked"]);

/** Inferred union of credential status literals. */
export type CredentialStatusType = z.infer<typeof CredentialStatus>;

/**
 * Configuration used to issue a new credential.
 *
 * Scopes an operator to specific conversations, with optional
 * policy reference and inline allow/deny overrides.
 */
export const CredentialConfig: z.ZodObject<{
  operatorId: z.ZodType<string>;
  chatIds: z.ZodArray<z.ZodType<string>>;
  policyId: z.ZodOptional<z.ZodType<string>>;
  allow: z.ZodOptional<z.ZodArray<typeof PermissionScope>>;
  deny: z.ZodOptional<z.ZodArray<typeof PermissionScope>>;
  ttlSeconds: z.ZodOptional<z.ZodNumber>;
}> = z.object({
  /** Which operator this credential is for. */
  operatorId: OperatorId,
  /** Scoped conversations this credential grants access to. */
  chatIds: z.array(ConversationId).min(1),
  /** Reference to a reusable permission policy. */
  policyId: PolicyId.optional(),
  /** Inline permission scopes to allow (merged with policy). */
  allow: z.array(PermissionScope).optional(),
  /** Inline permission scopes to deny (merged with policy). */
  deny: z.array(PermissionScope).optional(),
  /** Time-to-live in seconds. Runtime defaults to 3600 if omitted. */
  ttlSeconds: z.number().int().positive().optional(),
});

/** Inferred type for credential configuration. */
export type CredentialConfigType = z.infer<typeof CredentialConfig>;

/**
 * Actor that issued a credential.
 *
 * The current runtime can issue credentials directly as the signet owner
 * via admin auth, or via a delegated admin/superadmin operator flow.
 */
export const CredentialIssuer: z.ZodUnion<
  [z.ZodType<string>, z.ZodLiteral<"owner">]
> = z.union([OperatorId, z.literal("owner")]);

/** Inferred type for a credential issuer. */
export type CredentialIssuerType = z.infer<typeof CredentialIssuer>;

/**
 * Persisted credential record with identity, status, and timestamps.
 */
export const CredentialRecord: z.ZodObject<{
  id: z.ZodType<string>;
  config: typeof CredentialConfig;
  inboxIds: z.ZodArray<z.ZodType<string>>;
  status: typeof CredentialStatus;
  issuedAt: z.ZodString;
  expiresAt: z.ZodString;
  issuedBy: typeof CredentialIssuer;
}> = z
  .object({
    /** Unique credential identifier (`cred_` prefix). */
    id: CredentialId,
    /** The credential configuration. */
    config: CredentialConfig,
    /** XMTP inboxes bound to this credential. */
    inboxIds: z.array(InboxId),
    /** Current lifecycle status. */
    status: CredentialStatus,
    /** ISO 8601 timestamp when the credential was issued. */
    issuedAt: z.string().datetime(),
    /** ISO 8601 timestamp when the credential expires. */
    expiresAt: z.string().datetime(),
    /** Owner or delegated operator that issued this credential. */
    issuedBy: CredentialIssuer,
  })
  .describe("Persisted credential record");

/** Inferred type for {@link CredentialRecord}. */
export type CredentialRecordType = z.infer<typeof CredentialRecord>;

/**
 * Opaque credential token metadata returned for verification.
 */
export const CredentialToken: z.ZodObject<{
  credentialId: z.ZodType<string>;
  operatorId: z.ZodType<string>;
  fingerprint: z.ZodString;
  issuedAt: z.ZodString;
  expiresAt: z.ZodString;
}> = z
  .object({
    /** Credential this token belongs to. */
    credentialId: CredentialId,
    /** Operator this token was issued for. */
    operatorId: OperatorId,
    /** Token fingerprint for verification. */
    fingerprint: z.string(),
    /** ISO 8601 timestamp when the token was issued. */
    issuedAt: z.string().datetime(),
    /** ISO 8601 timestamp when the token expires. */
    expiresAt: z.string().datetime(),
  })
  .describe("Credential token metadata for verification");

/** Inferred type for {@link CredentialToken}. */
export type CredentialTokenType = z.infer<typeof CredentialToken>;

/**
 * Issued credential containing the bearer token (shown once)
 * and the full credential record.
 */
export const IssuedCredential: z.ZodObject<{
  token: z.ZodString;
  credential: typeof CredentialRecord;
}> = z
  .object({
    /** The bearer token, shown only at issuance. */
    token: z.string().min(1),
    /** The credential record. */
    credential: CredentialRecord,
  })
  .describe("Issued credential with bearer token");

/** Inferred type for {@link IssuedCredential}. */
export type IssuedCredentialType = z.infer<typeof IssuedCredential>;
