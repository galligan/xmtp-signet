import { Result } from "better-result";
import type {
  Attestation,
  GrantConfig,
  ViewConfig,
} from "@xmtp-broker/schemas";
import { AttestationSchema, ValidationError } from "@xmtp-broker/schemas";
import { generateAttestationId } from "./attestation-id.js";
import { canonicalize } from "./canonicalize.js";
import { grantConfigToOps, grantConfigToToolScopes } from "./grant-ops.js";

/** Default attestation validity period: 24 hours in seconds. */
const DEFAULT_TTL_SECONDS = 86400;

/** Input fields for building an attestation. */
export interface AttestationInput {
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

/** Result of building an attestation. */
export interface AttestationBuildResult {
  readonly attestation: Attestation;
  readonly serialized: Uint8Array;
}

/**
 * Builds an attestation from input fields, linking to the previous
 * attestation if one exists. Validates the result against AttestationSchema.
 */
export function buildAttestation(
  input: AttestationInput,
  previousAttestationId: string | null,
  ttlSeconds?: number,
): Result<AttestationBuildResult, ValidationError> {
  const now = new Date();
  const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttl * 1000);

  const raw = {
    attestationId: generateAttestationId(),
    previousAttestationId,
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

  const parsed = AttestationSchema.safeParse(raw);
  if (!parsed.success) {
    return Result.err(
      ValidationError.create("attestation", parsed.error.message),
    );
  }

  const attestation = parsed.data;
  const serialized = canonicalize(attestation);

  return Result.ok({ attestation, serialized });
}
