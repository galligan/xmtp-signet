import { Result } from "better-result";
import type {
  SealPayloadType,
  SealChainType,
  SealDeltaType,
  ScopeSetType,
  ScopeModeType,
  TrustTierType,
  OperatorDisclosuresType,
  ProvenanceMapType,
} from "@xmtp/signet-schemas";
import { SealPayload, ValidationError } from "@xmtp/signet-schemas";
import { generateSealId } from "./seal-id.js";
import { canonicalize } from "./canonicalize.js";
import { computePayloadDelta } from "./compute-delta.js";

/**
 * Input fields for building a seal.
 *
 * Derived fields (sealId, issuedAt) are never accepted here — they are
 * computed internally by buildSeal(). This is a correctness invariant.
 */
export interface SealInput {
  readonly credentialId: string;
  readonly operatorId: string;
  readonly chatId: string;
  readonly scopeMode: ScopeModeType;
  readonly permissions: ScopeSetType;
  readonly adminAccess?: { operatorId: string; expiresAt: string } | undefined;
  /** True when the seal should disclose synthetic bypass fallback input. */
  readonly bypassed?: true | undefined;
  /** Signet-managed trust tier for this operator/runtime. */
  readonly trustTier?: TrustTierType | undefined;
  /** Operator-declared claims about the runtime environment. */
  readonly operatorDisclosures?: OperatorDisclosuresType | undefined;
  /** Provenance metadata for disclosed and externally-verified claims. */
  readonly provenanceMap?: ProvenanceMapType | undefined;
}

/** Result of building a seal. */
export interface SealBuildResult {
  readonly chain: SealChainType;
  readonly serialized: Uint8Array;
}

/**
 * Builds a seal chain from input fields, linking to the previous
 * seal payload if one exists. Validates the result against SealPayload.
 */
export function buildSeal(
  input: SealInput,
  previousPayload?: SealPayloadType,
): Result<SealBuildResult, ValidationError> {
  const now = new Date();

  const raw = {
    sealId: generateSealId(),
    credentialId: input.credentialId,
    operatorId: input.operatorId,
    chatId: input.chatId,
    scopeMode: input.scopeMode,
    permissions: {
      allow: [...input.permissions.allow],
      deny: [...input.permissions.deny],
    },
    adminAccess: input.adminAccess ? { ...input.adminAccess } : undefined,
    issuedAt: now.toISOString(),
    bypassed: input.bypassed,
    trustTier: input.trustTier,
    operatorDisclosures: input.operatorDisclosures
      ? {
          ...input.operatorDisclosures,
          inferenceProviders: input.operatorDisclosures.inferenceProviders
            ? [...input.operatorDisclosures.inferenceProviders]
            : undefined,
        }
      : undefined,
    provenanceMap: input.provenanceMap ? { ...input.provenanceMap } : undefined,
  };

  const parsed = SealPayload.safeParse(raw);
  if (!parsed.success) {
    return Result.err(ValidationError.create("seal", parsed.error.message));
  }

  const current: SealPayloadType = parsed.data;

  // Compute delta between current and previous
  const delta: SealDeltaType = previousPayload
    ? computePayloadDelta(previousPayload, current)
    : { added: [], removed: [], changed: [] };

  const chain: SealChainType = {
    current,
    previous: previousPayload,
    delta,
  };

  const serialized = canonicalize(chain);

  return Result.ok({ chain, serialized });
}
