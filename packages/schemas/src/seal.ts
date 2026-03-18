import { z } from "zod";
import { ContentTypeId } from "./content-types.js";
import { ViewMode } from "./view.js";

/** Where the agent performs inference. */
export const InferenceMode: z.ZodEnum<
  ["local", "external", "hybrid", "unknown"]
> = z
  .enum(["local", "external", "hybrid", "unknown"])
  .describe("How the agent performs inference");

/** Where the agent performs inference. */
export type InferenceMode = z.infer<typeof InferenceMode>;

/** Which content may leave the signet boundary. */
export const ContentEgressScope: z.ZodEnum<
  ["full-messages", "summaries-only", "tool-calls-only", "none", "unknown"]
> = z
  .enum([
    "full-messages",
    "summaries-only",
    "tool-calls-only",
    "none",
    "unknown",
  ])
  .describe("What content leaves the signet boundary");

/** Which content may leave the signet boundary. */
export type ContentEgressScope = z.infer<typeof ContentEgressScope>;

/** How long the provider retains content. */
/** Zod schema for provider-side retention scope. */
export const RetentionAtProvider: z.ZodEnum<
  ["none", "session", "persistent", "unknown"]
> = z
  .enum(["none", "session", "persistent", "unknown"])
  .describe("How long the inference provider retains content");

/** How long the provider retains content. */
export type RetentionAtProvider = z.infer<typeof RetentionAtProvider>;

/** Where the signet is hosted. */
/** Zod schema for how the signet is hosted. */
export const HostingMode: z.ZodEnum<["local", "self-hosted", "managed"]> = z
  .enum(["local", "self-hosted", "managed"])
  .describe("Where the signet runs");

/** Where the signet is hosted. */
export type HostingMode = z.infer<typeof HostingMode>;

/** Highest trust tier the signet can demonstrate. */
/** Zod schema for the highest trust tier demonstrated by a seal. */
export const TrustTier: z.ZodEnum<
  ["unverified", "source-verified", "reproducibly-verified", "runtime-attested"]
> = z
  .enum([
    "unverified",
    "source-verified",
    "reproducibly-verified",
    "runtime-attested",
  ])
  .describe("Highest trust tier the signet can demonstrate");

/** Highest trust tier the signet can demonstrate. */
export type TrustTier = z.infer<typeof TrustTier>;

/** Rules governing how a seal can be revoked. */
export type RevocationRules = {
  maxTtlSeconds: number;
  requireHeartbeat: boolean;
  ownerCanRevoke: boolean;
  adminCanRemove: boolean;
};

/** Zod schema for seal revocation rules. */
export const RevocationRules: z.ZodType<RevocationRules> = z
  .object({
    maxTtlSeconds: z
      .number()
      .int()
      .positive()
      .describe("Maximum seal lifetime in seconds"),
    requireHeartbeat: z
      .boolean()
      .describe("Whether missed heartbeats trigger auto-revocation"),
    ownerCanRevoke: z
      .boolean()
      .describe("Whether the owner can revoke at any time"),
    adminCanRemove: z
      .boolean()
      .describe("Whether group admins can remove the agent"),
  })
  .describe("Rules governing how this seal can be revoked");

/** Group-visible capability seal for an agent. */
export type Seal = {
  sealId: string;
  previousSealId: string | null;
  agentInboxId: string;
  ownerInboxId: string;
  groupId: string;
  threadScope: string | null;
  viewMode: ViewMode;
  contentTypes: string[];
  grantedOps: string[];
  toolScopes: string[];
  inferenceMode: InferenceMode;
  inferenceProviders: string[];
  contentEgressScope: ContentEgressScope;
  retentionAtProvider: RetentionAtProvider;
  hostingMode: HostingMode;
  trustTier: TrustTier;
  buildProvenanceRef: string | null;
  verifierStatementRef: string | null;
  sessionKeyFingerprint: string | null;
  policyHash: string;
  heartbeatInterval?: number | undefined;
  issuedAt: string;
  expiresAt: string;
  revocationRules: RevocationRules;
  issuer: string;
};

/** Zod schema for a group-visible capability seal. */
export const SealSchema: z.ZodType<Seal> = z
  .object({
    sealId: z.string().describe("Unique identifier for this seal"),
    previousSealId: z
      .string()
      .nullable()
      .describe("ID of the seal this supersedes, null for initial"),
    agentInboxId: z.string().describe("XMTP inbox ID of the agent"),
    ownerInboxId: z.string().describe("XMTP inbox ID of the agent's owner"),
    groupId: z.string().describe("Group this seal applies to"),
    threadScope: z
      .string()
      .nullable()
      .describe(
        "Thread scope if narrower than full group, null for group-wide",
      ),
    viewMode: ViewMode.describe("Current view mode"),
    contentTypes: z
      .array(ContentTypeId)
      .describe("Content types the agent can see"),
    grantedOps: z.array(z.string()).describe("Granted operation identifiers"),
    toolScopes: z
      .array(z.string())
      .describe("Tool scope identifiers the agent may use"),
    inferenceMode: InferenceMode.describe("How the agent performs inference"),
    inferenceProviders: z
      .array(z.string())
      .describe("Envelope of inference providers the agent may use"),
    contentEgressScope: ContentEgressScope.describe(
      "What content leaves the signet boundary",
    ),
    retentionAtProvider: RetentionAtProvider.describe(
      "Provider-side retention policy",
    ),
    hostingMode: HostingMode.describe("Where the signet runs"),
    trustTier: TrustTier.describe("Highest demonstrated trust tier"),
    buildProvenanceRef: z
      .string()
      .nullable()
      .describe("Reference to build provenance bundle, null if unavailable"),
    verifierStatementRef: z
      .string()
      .nullable()
      .describe("Reference to verifier statement, null if unavailable"),
    sessionKeyFingerprint: z
      .string()
      .nullable()
      .describe("Fingerprint of the current session key, null if not bound"),
    policyHash: z
      .string()
      .describe("Hash of the full policy config for integrity checking"),
    heartbeatInterval: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe("Expected heartbeat cadence in seconds"),
    issuedAt: z
      .string()
      .datetime()
      .describe("ISO 8601 timestamp when this seal was issued"),
    expiresAt: z
      .string()
      .datetime()
      .describe("ISO 8601 timestamp when this seal expires"),
    revocationRules: RevocationRules.describe(
      "Rules governing revocation of this seal",
    ),
    issuer: z
      .string()
      .describe("Identity of the seal issuer (signet's signing identity)"),
  })
  .describe("Group-visible capability seal for an agent");
