import { Result } from "better-result";
import type {
  AgentRevocationReason,
  Attestation,
  BrokerError,
} from "@xmtp-broker/schemas";
import {
  AttestationError,
  RevocationAttestation,
  ValidationError,
} from "@xmtp-broker/schemas";
import type {
  AttestationManager,
  AttestationPublisher,
  AttestationSigner,
  SignedAttestation,
} from "@xmtp-broker/contracts";
import { isMaterialChange } from "@xmtp-broker/policy";
import { buildAttestation } from "./build.js";
import type { AttestationInput } from "./build.js";
import { generateAttestationId } from "./attestation-id.js";
import { computeInputDelta } from "./compute-delta.js";
import { canonicalize } from "./canonicalize.js";

/** Renewal threshold: renew when 75% of TTL has elapsed. */
const RENEWAL_THRESHOLD = 0.75;

/**
 * Resolves the attestation input for a session+group pair.
 * The broker runtime provides this, translating session policy
 * into the flat AttestationInput structure.
 */
export type InputResolver = (
  sessionId: string,
  groupId: string,
) => Promise<Result<AttestationInput, BrokerError>>;

/** Dependencies for the attestation manager. */
export interface AttestationManagerDeps {
  readonly signer: AttestationSigner;
  readonly publisher: AttestationPublisher;
  readonly resolveInput: InputResolver;
}

/** AttestationManager that satisfies the contracts interface plus renewal check. */
export interface AttestationManagerImpl extends AttestationManager {
  needsRenewal(attestation: Attestation): boolean;
}

/** Composite key for agent+group tracking. */
function chainKey(agentInboxId: string, groupId: string): string {
  return `${agentInboxId}:${groupId}`;
}

/**
 * Creates an AttestationManager that handles the full attestation lifecycle:
 * creation, signing, publishing, chaining, renewal, and revocation.
 */
export function createAttestationManager(
  deps: AttestationManagerDeps,
): AttestationManagerImpl {
  // In-memory tracking of current attestation per agent+group
  const currentAttestations = new Map<string, SignedAttestation>();
  // Track attestations by ID for refresh/revoke lookups
  const attestationsById = new Map<string, SignedAttestation>();
  // Track which inputs produced which attestations (for refresh)
  const inputsByAttestationId = new Map<string, AttestationInput>();
  // Track revoked agent+group pairs
  const revokedPairs = new Set<string>();

  return {
    async issue(
      sessionId: string,
      groupId: string,
    ): Promise<Result<SignedAttestation, BrokerError>> {
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
          AttestationError.create(
            "",
            "Cannot issue attestation for revoked agent+group",
          ),
        );
      }

      // Materiality check: skip if no material change from previous
      const previous = currentAttestations.get(key);
      if (previous) {
        const previousInput = inputsByAttestationId.get(
          previous.attestation.attestationId,
        );
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

      const previousId = previous?.attestation.attestationId ?? null;

      // Build the attestation
      const buildResult = buildAttestation(input, previousId);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign
      const signResult = await deps.signer.sign(buildResult.value.attestation);
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
      currentAttestations.set(key, signed);
      attestationsById.set(signed.attestation.attestationId, signed);
      inputsByAttestationId.set(signed.attestation.attestationId, input);

      return Result.ok(signed);
    },

    async refresh(
      attestationId: string,
    ): Promise<Result<SignedAttestation, BrokerError>> {
      const existing = attestationsById.get(attestationId);
      if (!existing) {
        return Result.err(
          AttestationError.create(attestationId, "Attestation not found"),
        );
      }

      const input = inputsByAttestationId.get(attestationId);
      if (!input) {
        return Result.err(
          AttestationError.create(
            attestationId,
            "Input not found for attestation",
          ),
        );
      }

      const key = chainKey(
        existing.attestation.agentInboxId,
        existing.attestation.groupId,
      );
      const current = currentAttestations.get(key);
      if (current?.attestation.attestationId !== attestationId) {
        return Result.err(
          AttestationError.create(
            attestationId,
            "Only the current head attestation can be refreshed",
          ),
        );
      }

      // Check if this agent+group is revoked
      if (revokedPairs.has(key)) {
        return Result.err(
          AttestationError.create(
            attestationId,
            "Cannot refresh: agent+group pair has been revoked",
          ),
        );
      }

      // Build new attestation with same fields, new timestamps
      const buildResult = buildAttestation(input, attestationId);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign
      const signResult = await deps.signer.sign(buildResult.value.attestation);
      if (signResult.isErr()) {
        return signResult;
      }

      // Publish
      const publishResult = await deps.publisher.publish(
        existing.attestation.groupId,
        signResult.value,
      );
      if (publishResult.isErr()) {
        return publishResult;
      }

      // Track
      const signed = signResult.value;
      currentAttestations.set(key, signed);
      attestationsById.set(signed.attestation.attestationId, signed);
      inputsByAttestationId.set(signed.attestation.attestationId, input);

      return Result.ok(signed);
    },

    async revoke(
      attestationId: string,
      reason: AgentRevocationReason,
    ): Promise<Result<void, BrokerError>> {
      const existing = attestationsById.get(attestationId);
      if (!existing) {
        return Result.err(
          AttestationError.create(attestationId, "Attestation not found"),
        );
      }

      const key = chainKey(
        existing.attestation.agentInboxId,
        existing.attestation.groupId,
      );

      if (revokedPairs.has(key)) {
        return Result.err(
          AttestationError.create(attestationId, "Agent+group already revoked"),
        );
      }

      // Build revocation
      const now = new Date();
      const revocation = {
        attestationId: generateAttestationId(),
        previousAttestationId: attestationId,
        agentInboxId: existing.attestation.agentInboxId,
        groupId: existing.attestation.groupId,
        reason,
        revokedAt: now.toISOString(),
        issuer: existing.attestation.issuer,
      };

      // Validate revocation against schema
      const parsed = RevocationAttestation.safeParse(revocation);
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
        existing.attestation.groupId,
        signResult.value,
      );
      if (publishResult.isErr()) {
        return Result.err(publishResult.error);
      }

      // Mark as revoked and clear current
      revokedPairs.add(key);
      currentAttestations.delete(key);

      return Result.ok();
    },

    async current(
      agentInboxId: string,
      groupId: string,
    ): Promise<Result<SignedAttestation | null, BrokerError>> {
      const key = chainKey(agentInboxId, groupId);
      const current = currentAttestations.get(key) ?? null;
      return Result.ok(current);
    },

    needsRenewal(attestation: Attestation): boolean {
      const issuedAt = new Date(attestation.issuedAt).getTime();
      const expiresAt = new Date(attestation.expiresAt).getTime();
      const ttl = expiresAt - issuedAt;
      const threshold = issuedAt + ttl * RENEWAL_THRESHOLD;
      return Date.now() >= threshold;
    },
  };
}

function hasSignedPayloadChanges(
  previous: AttestationInput,
  next: AttestationInput,
): boolean {
  return toComparablePayload(previous) !== toComparablePayload(next);
}

function toComparablePayload(input: AttestationInput): string {
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
