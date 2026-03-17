import { Result } from "better-result";
import type { GrantConfig, Seal, ViewConfig } from "@xmtp/signet-schemas";
import { SealSchema, ValidationError } from "@xmtp/signet-schemas";
import { generateSealId } from "./seal-id.js";
import { canonicalize } from "./canonicalize.js";
import { grantConfigToOps, grantConfigToToolScopes } from "./grant-ops.js";

/** Default seal validity period: 24 hours in seconds. */
const DEFAULT_TTL_SECONDS = 86400;

/** Input fields for building a seal. */
export interface SealInput {
  readonly agentInboxId: string;
  readonly ownerInboxId: string;
  readonly groupId: string;
  readonly threadScope: string | null;
  readonly view: ViewConfig;
  readonly grant: GrantConfig;
  readonly inferenceMode: string;
  readonly inferenceProviders: readonly string[];
  readonly contentEgressScope: string;
  readonly retentionAtProvider: string;
  readonly hostingMode: string;
  readonly trustTier: string;
  readonly buildProvenanceRef: string | null;
  readonly verifierStatementRef: string | null;
  readonly sessionKeyFingerprint: string | null;
  readonly policyHash: string;
  readonly heartbeatInterval: number;
  readonly revocationRules: {
    readonly maxTtlSeconds: number;
    readonly requireHeartbeat: boolean;
    readonly ownerCanRevoke: boolean;
    readonly adminCanRemove: boolean;
  };
  readonly issuer: string;
}

/** Result of building a seal. */
export interface SealBuildResult {
  readonly seal: Seal;
  readonly serialized: Uint8Array;
}

/**
 * Builds a seal from input fields, linking to the previous
 * seal if one exists. Validates the result against SealSchema.
 */
export function buildSeal(
  input: SealInput,
  previousSealId: string | null,
  ttlSeconds?: number,
): Result<SealBuildResult, ValidationError> {
  const now = new Date();
  const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const raw = {
    sealId: generateSealId(),
    previousSealId,
    agentInboxId: input.agentInboxId,
    ownerInboxId: input.ownerInboxId,
    groupId: input.groupId,
    threadScope: input.threadScope,
    viewMode: input.view.mode,
    contentTypes: [...input.view.contentTypes],
    grantedOps: [...grantConfigToOps(input.grant)],
    toolScopes: [...grantConfigToToolScopes(input.grant)],
    inferenceMode: input.inferenceMode,
    inferenceProviders: [...input.inferenceProviders],
    contentEgressScope: input.contentEgressScope,
    retentionAtProvider: input.retentionAtProvider,
    hostingMode: input.hostingMode,
    trustTier: input.trustTier,
    buildProvenanceRef: input.buildProvenanceRef,
    verifierStatementRef: input.verifierStatementRef,
    sessionKeyFingerprint: input.sessionKeyFingerprint,
    policyHash: input.policyHash,
    heartbeatInterval: input.heartbeatInterval,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revocationRules: { ...input.revocationRules },
    issuer: input.issuer,
  };

  const parsed = SealSchema.safeParse(raw);
  if (!parsed.success) {
    return Result.err(ValidationError.create("seal", parsed.error.message));
  }

  const seal = parsed.data;
  const serialized = canonicalize(seal);

  return Result.ok({ seal, serialized });
}
