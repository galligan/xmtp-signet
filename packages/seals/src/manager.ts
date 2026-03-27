import { Result } from "better-result";
import type {
  AgentRevocationReason,
  SealPayloadType,
  SealEnvelopeType,
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
  PolicyDelta,
} from "@xmtp/signet-contracts";
import { isMaterialChange } from "@xmtp/signet-policy";
import { buildSeal } from "./build.js";
import type { SealInput } from "./build.js";
import { generateSealId } from "./seal-id.js";
import { computePayloadDelta } from "./compute-delta.js";
import { canonicalize } from "./canonicalize.js";

/** Renewal threshold: renew when 75% of TTL has elapsed. */
const RENEWAL_THRESHOLD = 0.75;

/**
 * Default seal validity period: 24 hours in milliseconds.
 * Used for needsRenewal when no expiresAt is available on the payload.
 */
const DEFAULT_TTL_MS = 86400 * 1000;

/**
 * Resolves the seal input for a credential+chat pair.
 * The signet runtime provides this, translating credential policy
 * into the flat SealInput structure.
 */
export type InputResolver = (
  credentialId: string,
  chatId: string,
) => Promise<Result<SealInput, SignetError>>;

/** Dependencies for the seal manager. */
export interface SealManagerDeps {
  readonly signer: SealStamper;
  readonly publisher: SealPublisher;
  readonly resolveInput: InputResolver;
}

/** SealManager that satisfies the contracts interface plus renewal check. */
export interface SealManagerImpl extends SealManager {
  /** Check if a seal payload needs renewal based on issuedAt age. */
  needsRenewal(payload: SealPayloadType): boolean;
}

/** Composite key for credential+chat tracking. */
function chainKey(credentialId: string, chatId: string): string {
  return `${credentialId}:${chatId}`;
}

/**
 * Creates a SealManager that handles the full seal lifecycle:
 * creation, signing, publishing, chaining, renewal, and revocation.
 */
export function createSealManager(deps: SealManagerDeps): SealManagerImpl {
  // In-memory tracking of current seal per credential+chat.
  const currentSeals = new Map<string, SealEnvelopeType>();
  // Track seals by ID for refresh/revoke lookups.
  const sealsById = new Map<string, SealEnvelopeType>();
  // Track which inputs produced which seals (for refresh).
  const inputsBySealId = new Map<string, SealInput>();
  // Track revoked credential+chat pairs
  const revokedPairs = new Set<string>();

  return {
    async issue(
      credentialId: string,
      chatId: string,
    ): Promise<Result<SealEnvelopeType, SignetError>> {
      // Resolve input from credential+chat
      const inputResult = await deps.resolveInput(credentialId, chatId);
      if (inputResult.isErr()) {
        return Result.err(inputResult.error);
      }
      const input = inputResult.value;

      const key = chainKey(input.credentialId, chatId);

      // Check if this credential+chat is revoked
      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create("", "Cannot issue seal for revoked credential+chat"),
        );
      }

      // Materiality check: skip if no material change from previous
      const previous = currentSeals.get(key);
      if (previous) {
        const previousInput = inputsBySealId.get(previous.chain.current.sealId);
        if (previousInput) {
          const delta = computePayloadDelta(previous.chain.current, {
            ...previous.chain.current,
            permissions: input.permissions,
            scopeMode: input.scopeMode,
            adminAccess: input.adminAccess,
          });
          const policyDelta: PolicyDelta = {
            added: [...delta.added],
            removed: [...delta.removed],
            changed: delta.changed.map((c) => ({ ...c })),
          };
          if (
            !isMaterialChange(policyDelta) &&
            !hasInputChanges(previousInput, input)
          ) {
            return Result.ok(previous);
          }
        }
      }

      const previousPayload = previous?.chain.current;

      // Build the seal chain
      const buildResult = buildSeal(input, previousPayload);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign the current payload
      const signResult = await deps.signer.sign(
        buildResult.value.chain.current,
      );
      if (signResult.isErr()) {
        return signResult;
      }

      // Replace the chain on the signed envelope with the full chain
      const envelope: SealEnvelopeType = {
        ...signResult.value,
        chain: buildResult.value.chain,
      };

      // Publish
      const publishResult = await deps.publisher.publish(chatId, envelope);
      if (publishResult.isErr()) {
        return publishResult;
      }

      // Track
      currentSeals.set(key, envelope);
      sealsById.set(envelope.chain.current.sealId, envelope);
      inputsBySealId.set(envelope.chain.current.sealId, input);

      return Result.ok(envelope);
    },

    async refresh(
      sealId: string,
    ): Promise<Result<SealEnvelopeType, SignetError>> {
      const existing = sealsById.get(sealId);
      if (!existing) {
        return Result.err(SealError.create(sealId, "Seal not found"));
      }

      const input = inputsBySealId.get(sealId);
      if (!input) {
        return Result.err(SealError.create(sealId, "Input not found for seal"));
      }

      const current = existing.chain.current;
      const key = chainKey(current.credentialId, current.chatId);
      const head = currentSeals.get(key);
      if (head?.chain.current.sealId !== sealId) {
        return Result.err(
          SealError.create(
            sealId,
            "Only the current head seal can be refreshed",
          ),
        );
      }

      // Check if this credential+chat is revoked
      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create(
            sealId,
            "Cannot refresh: credential+chat pair has been revoked",
          ),
        );
      }

      // Build a new seal with the same fields and new timestamps.
      const buildResult = buildSeal(input, current);
      if (buildResult.isErr()) {
        return Result.err(buildResult.error);
      }

      // Sign
      const signResult = await deps.signer.sign(
        buildResult.value.chain.current,
      );
      if (signResult.isErr()) {
        return signResult;
      }

      const envelope: SealEnvelopeType = {
        ...signResult.value,
        chain: buildResult.value.chain,
      };

      // Publish
      const publishResult = await deps.publisher.publish(
        current.chatId,
        envelope,
      );
      if (publishResult.isErr()) {
        return publishResult;
      }

      // Track
      currentSeals.set(key, envelope);
      sealsById.set(envelope.chain.current.sealId, envelope);
      inputsBySealId.set(envelope.chain.current.sealId, input);

      return Result.ok(envelope);
    },

    async revoke(
      sealId: string,
      reason: AgentRevocationReason,
    ): Promise<Result<void, SignetError>> {
      const existing = sealsById.get(sealId);
      if (!existing) {
        return Result.err(SealError.create(sealId, "Seal not found"));
      }

      const current = existing.chain.current;
      const key = chainKey(current.credentialId, current.chatId);

      if (revokedPairs.has(key)) {
        return Result.err(
          SealError.create(sealId, "Credential+chat already revoked"),
        );
      }

      // Build revocation
      const now = new Date();
      const revocation = {
        sealId: generateSealId(),
        previousSealId: sealId,
        operatorId: current.operatorId,
        credentialId: current.credentialId,
        chatId: current.chatId,
        reason,
        revokedAt: now.toISOString(),
        issuer: "signet",
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
        current.chatId,
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
      credentialId: string,
      chatId: string,
    ): Promise<Result<SealEnvelopeType | null, SignetError>> {
      const key = chainKey(credentialId, chatId);
      const current = currentSeals.get(key) ?? null;
      return Result.ok(current);
    },

    needsRenewal(payload: SealPayloadType): boolean {
      const issuedAt = new Date(payload.issuedAt).getTime();
      const now = Date.now();
      const threshold = issuedAt + DEFAULT_TTL_MS * RENEWAL_THRESHOLD;
      return now >= threshold;
    },
  };
}

/** Check if non-permission fields changed between inputs. */
function hasInputChanges(previous: SealInput, next: SealInput): boolean {
  return (
    previous.credentialId !== next.credentialId ||
    previous.operatorId !== next.operatorId ||
    previous.chatId !== next.chatId ||
    previous.scopeMode !== next.scopeMode ||
    stableSerialize(previous.adminAccess) !==
      stableSerialize(next.adminAccess) ||
    stableSerialize(previous.operatorDisclosures) !==
      stableSerialize(next.operatorDisclosures) ||
    stableSerialize(previous.provenanceMap) !==
      stableSerialize(next.provenanceMap)
  );
}

function stableSerialize(value: unknown): string {
  return new TextDecoder().decode(canonicalize(value));
}
