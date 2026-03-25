import type { PolicyDelta } from "@xmtp/signet-contracts";

function isDeltaArray(
  deltas: PolicyDelta | readonly PolicyDelta[],
): deltas is readonly PolicyDelta[] {
  return Array.isArray(deltas);
}

function normalizeDeltas(
  deltas: PolicyDelta | readonly PolicyDelta[],
): readonly PolicyDelta[] {
  return isDeltaArray(deltas) ? deltas : [deltas];
}

function isSingleDeltaMaterial(delta: PolicyDelta): boolean {
  return (
    delta.added.length > 0 ||
    delta.removed.length > 0 ||
    delta.changed.length > 0
  );
}

function isSingleDeltaEscalation(delta: PolicyDelta): boolean {
  if (delta.added.length > 0) {
    return true;
  }

  return delta.changed.some((change) => change.to === "allow");
}

/**
 * Classifies whether any delta in a set of policy changes is material
 * (triggers a new seal) or routine (silent).
 */
export function isMaterialChange(
  deltas: PolicyDelta | readonly PolicyDelta[],
): boolean {
  return normalizeDeltas(deltas).some(isSingleDeltaMaterial);
}

/**
 * Classifies whether any delta in a set of policy changes requires
 * reauthorization.
 *
 * Within this branch, the policy delta is a scope-set diff, so
 * reauthorization only applies to new allow scopes or deny->allow moves.
 */
export function requiresReauthorization(
  deltas: PolicyDelta | readonly PolicyDelta[],
): boolean {
  return normalizeDeltas(deltas).some(isSingleDeltaEscalation);
}
