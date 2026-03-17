import { Result } from "better-result";
import type {
  AgentRevocationReason,
  Seal,
  SignetError,
} from "@xmtp/signet-schemas";
import {
  SealError,
  RevocationSeal,
  ValidationError,
} from "@xmtp/signet-schemas";
import type {
  SealManager,
  SealPublisher,
  SealStamper,
  SealEnvelope,
} from "@xmtp/signet-contracts";
import { isMaterialChange } from "@xmtp/signet-policy";
import { buildSeal } from "./build.js";
import type { SealInput } from "./build.js";
import { generateSealId } from "./seal-id.js";
import { computeInputDelta } from "./compute-delta.js";
import { canonicalize } from "./canonicalize.js";

/** Renewal threshold: renew when 75% of TTL has elapsed. */
const RENEWAL_THRESHOLD = 0.75;

/**
 * Resolves the seal input for a session+group pair.
 * The signet runtime provides this, translating session policy
 * into the flat SealInput structure.
 */
export type InputResolver = (
  sessionId: string,
  groupId: string,
) => Promise<Result<SealInput, SignetError>>;

/** Dependencies for the seal manager. */
export interface SealManagerDeps {
  readonly signer: SealStamper;
  readonly publisher: SealPublisher;
  readonly resolveInput: InputResolver;
}

/** SealManager that satisfies the contracts interface plus renewal check. */
export interface SealManagerImpl extends SealManager {
  needsRenewal(seal: Seal): boolean;
}

/** Composite key for agent+group tracking. */
function chainKey(agentInboxId: string, groupId: string): string {
  return `${agentInboxId}:${groupId}`;
}

/**
 * Creates a SealManager that handles the full seal lifecycle:
 * creation, signing, publishing, chaining, renewal, and revocation.
 */
export function createSealManager(deps: SealManagerDeps): SealManagerImpl {
  // In-memory tracking of current seal per agent+group.
  const currentSeals = new Map<string, SealEnvelope>();
  // Track seals by ID for refresh/revoke lookups.
  const sealsById = new Map<string, SealEnvelope>();
  // Track which inputs produced which seals (for refresh).
  const inputsBySealId = new Map<string, SealInput>();
  // Track revoked agent+group pairs
  const revokedPairs = new Set<string>();

  return {
    async issue(
      sessionId: string,
      groupId: string,
    ): Promise<Result<SealEnvelope, SignetError>> {
      // Resolve input from session+group
      const inputResult = await deps.resolveInput(sessionId, groupId);
      if (inputResult.isErr()) {
        return Result.err(inputResult.error);
      }
      const input = inputResult.value;

      const key = chainKey(input.agentInboxId, groupId);

      // Check if this agent+group is revoked
      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create("", "Cannot issue seal for revoked agent+group"),
        );
      }

      // Materiality check: skip if no material change from previous
      const previous = currentSeals.get(key);
      if (previous) {
        const previousInput = inputsBySealId.get(previous.seal.sealId);
        if (previousInput) {
          const delta = computeInputDelta(previousInput, input);
          if (
            !isMaterialChange([delta]) &&
            !hasSignedPayloadChanges(previousInput, input)
          ) {
            return Result.ok(previous);
          }
        }
      }

      const previousId = previous?.seal.sealId ?? null;

      // Build the seal
      const buildResult = buildSeal(input, previousId);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign
      const signResult = await deps.signer.sign(buildResult.value.seal);
      if (signResult.isErr()) {
        return signResult;
      }

      // Publish
      const publishResult = await deps.publisher.publish(
        groupId,
        signResult.value,
      );
      if (publishResult.isErr()) {
        return publishResult;
      }

      // Track
      const signed = signResult.value;
      currentSeals.set(key, signed);
      sealsById.set(signed.seal.sealId, signed);
      inputsBySealId.set(signed.seal.sealId, input);

      return Result.ok(signed);
    },

    async refresh(sealId: string): Promise<Result<SealEnvelope, SignetError>> {
      const existing = sealsById.get(sealId);
      if (!existing) {
        return Result.err(SealError.create(sealId, "Seal not found"));
      }

      const input = inputsBySealId.get(sealId);
      if (!input) {
        return Result.err(SealError.create(sealId, "Input not found for seal"));
      }

      const key = chainKey(existing.seal.agentInboxId, existing.seal.groupId);
      const current = currentSeals.get(key);
      if (current?.seal.sealId !== sealId) {
        return Result.err(
          SealError.create(
            sealId,
            "Only the current head seal can be refreshed",
          ),
        );
      }

      // Check if this agent+group is revoked
      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create(
            sealId,
            "Cannot refresh: agent+group pair has been revoked",
          ),
        );
      }

      // Build a new seal with the same fields and new timestamps.
      const buildResult = buildSeal(input, sealId);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign
      const signResult = await deps.signer.sign(buildResult.value.seal);
      if (signResult.isErr()) {
        return signResult;
      }

      // Publish
      const publishResult = await deps.publisher.publish(
        existing.seal.groupId,
        signResult.value,
      );
      if (publishResult.isErr()) {
        return publishResult;
      }

      // Track
      const signed = signResult.value;
      currentSeals.set(key, signed);
      sealsById.set(signed.seal.sealId, signed);
      inputsBySealId.set(signed.seal.sealId, input);

      return Result.ok(signed);
    },

    async revoke(
      sealId: string,
      reason: AgentRevocationReason,
    ): Promise<Result<void, SignetError>> {
      const existing = sealsById.get(sealId);
      if (!existing) {
        return Result.err(SealError.create(sealId, "Seal not found"));
      }

      const key = chainKey(existing.seal.agentInboxId, existing.seal.groupId);

      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create(sealId, "Agent+group already revoked"),
        );
      }

      // Build revocation
      const now = new Date();
      const revocation = {
        sealId: generateSealId(),
        previousSealId: sealId,
        agentInboxId: existing.seal.agentInboxId,
        groupId: existing.seal.groupId,
        reason,
        revokedAt: now.toISOString(),
        issuer: existing.seal.issuer,
      };

      // Validate revocation against schema
      const parsed = RevocationSeal.safeParse(revocation);
      if (!parsed.success) {
        return Result.err(
          ValidationError.create("revocation", parsed.error.message),
        );
      }

      // Sign revocation (use validated data)
      const signResult = await deps.signer.signRevocation(parsed.data);
      if (signResult.isErr()) {
        return Result.err(signResult.error);
      }

      // Publish revocation
      const publishResult = await deps.publisher.publishRevocation(
        existing.seal.groupId,
        signResult.value,
      );
      if (publishResult.isErr()) {
        return Result.err(publishResult.error);
      }

      // Mark as revoked and clear current
      revokedPairs.add(key);
      currentSeals.delete(key);

      return Result.ok();
    },

    async current(
      agentInboxId: string,
      groupId: string,
    ): Promise<Result<SealEnvelope | null, SignetError>> {
      const key = chainKey(agentInboxId, groupId);
      const current = currentSeals.get(key) ?? null;
      return Result.ok(current);
    },

    needsRenewal(seal: Seal): boolean {
      const issuedAt = new Date(seal.issuedAt).getTime();
      const expiresAt = new Date(seal.expiresAt).getTime();
      const ttl = expiresAt - issuedAt;
      const threshold = issuedAt + ttl * RENEWAL_THRESHOLD;
      return Date.now() >= threshold;
    },
  };
}

function hasSignedPayloadChanges(
  previous: SealInput,
  next: SealInput,
): boolean {
  return toComparablePayload(previous) !== toComparablePayload(next);
}

function toComparablePayload(input: SealInput): string {
  const payload = {
    agentInboxId: input.agentInboxId,
    ownerInboxId: input.ownerInboxId,
    groupId: input.groupId,
    threadScope: input.threadScope,
    view: input.view,
    grant: input.grant,
    inferenceMode: input.inferenceMode,
    inferenceProviders: input.inferenceProviders,
    contentEgressScope: input.contentEgressScope,
    retentionAtProvider: input.retentionAtProvider,
    hostingMode: input.hostingMode,
    trustTier: input.trustTier,
    buildProvenanceRef: input.buildProvenanceRef,
    verifierStatementRef: input.verifierStatementRef,
    sessionKeyFingerprint: input.sessionKeyFingerprint,
    policyHash: input.policyHash,
    heartbeatInterval: input.heartbeatInterval,
    revocationRules: input.revocationRules,
    issuer: input.issuer,
  };
  return new TextDecoder().decode(canonicalize(payload));
}
