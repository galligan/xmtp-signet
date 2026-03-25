import type { PolicyDelta } from "@xmtp/signet-contracts";

function isDeltaArray(
  deltas: PolicyDelta | readonly PolicyDelta[],
): deltas is readonly PolicyDelta[] {
  return Array.isArray(deltas);
}

function normalizeDeltas(
  deltas: PolicyDelta | readonly PolicyDelta[],
): readonly PolicyDelta[] {
  if (isDeltaArray(deltas)) {
    return deltas;
  }

  return [deltas];
}

/**
 * Classifies whether any delta in a set of policy changes is material
 * (triggers a new seal) or routine (silent).
 */
export function isMaterialChange(
  deltas: PolicyDelta | readonly PolicyDelta[],
): boolean {
  return normalizeDeltas(deltas).some((delta) => isSingleDeltaMaterial(delta));
}

function isSingleDeltaMaterial(delta: PolicyDelta): boolean {
  return (
    delta.added.length > 0 ||
    delta.removed.length > 0 ||
    delta.changed.length > 0
  );
}

/**
 * Classifies whether any delta in a set of policy changes requires
 * credential reauthorization (privilege escalation).
 */
export function requiresReauthorization(
  deltas: PolicyDelta | readonly PolicyDelta[],
): boolean {
  return normalizeDeltas(deltas).some((delta) =>
    isSingleDeltaEscalation(delta),
  );
}

function isSingleDeltaEscalation(delta: PolicyDelta): boolean {
  return (
    delta.added.length > 0 ||
    delta.changed.some((change) => change.to === "allow")
  );
}
