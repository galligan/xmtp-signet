import { Result } from "better-result";
import type { SealChainType, SealDeltaType } from "@xmtp/signet-schemas";
import { ValidationError } from "@xmtp/signet-schemas";
import { computePayloadDelta } from "./compute-delta.js";

/**
 * Validates a seal chain's structural integrity.
 *
 * When a previous payload exists, verifies:
 * 1. The operator matches between current and previous.
 * 2. The credential matches between current and previous.
 * 3. The chat matches between current and previous.
 * 4. The current issuedAt is not before the previous issuedAt.
 */
export function validateSealChain(
  chain: SealChainType,
): Result<void, ValidationError> {
  const { current, previous } = chain;

  if (previous === undefined) {
    return Result.ok();
  }

  if (current.operatorId !== previous.operatorId) {
    return Result.err(
      ValidationError.create(
        "chain",
        "Operator mismatch: current and previous seal must belong to the same operator",
      ),
    );
  }

  if (current.credentialId !== previous.credentialId) {
    return Result.err(
      ValidationError.create(
        "chain",
        "Credential mismatch: current and previous seal must belong to the same credential",
      ),
    );
  }

  if (current.chatId !== previous.chatId) {
    return Result.err(
      ValidationError.create(
        "chain",
        "Chat mismatch: current and previous seal must belong to the same chat",
      ),
    );
  }

  const currentTime = new Date(current.issuedAt).getTime();
  const previousTime = new Date(previous.issuedAt).getTime();

  if (currentTime < previousTime) {
    return Result.err(
      ValidationError.create(
        "chain",
        "issuedAt of current seal must not be before previous seal",
      ),
    );
  }

  return Result.ok();
}

/**
 * Verifies that a chain's stored delta matches the actual difference
 * between the current and previous payloads. For first seals (no previous),
 * the delta must be empty.
 */
export function verifyChainDelta(
  chain: SealChainType,
): Result<void, ValidationError> {
  const { current, previous, delta } = chain;

  const expected: SealDeltaType = previous
    ? computePayloadDelta(previous, current)
    : { added: [], removed: [], changed: [] };

  if (!deltaEquals(expected, delta)) {
    return Result.err(
      ValidationError.create(
        "chain",
        "Delta mismatch: stored delta does not match recomputed delta",
      ),
    );
  }

  return Result.ok();
}

/** Deep equality check for two seal deltas. */
function deltaEquals(a: SealDeltaType, b: SealDeltaType): boolean {
  if (a.added.length !== b.added.length) return false;
  if (a.removed.length !== b.removed.length) return false;
  if (a.changed.length !== b.changed.length) return false;

  const sortedAddedA = [...a.added].sort();
  const sortedAddedB = [...b.added].sort();
  if (sortedAddedA.some((v, i) => v !== sortedAddedB[i])) return false;

  const sortedRemovedA = [...a.removed].sort();
  const sortedRemovedB = [...b.removed].sort();
  if (sortedRemovedA.some((v, i) => v !== sortedRemovedB[i])) return false;

  const sortChanges = (
    arr: SealDeltaType["changed"],
  ): SealDeltaType["changed"] =>
    [...arr].sort((x, y) => (x.scope < y.scope ? -1 : 1));

  const sortedChangedA = sortChanges(a.changed);
  const sortedChangedB = sortChanges(b.changed);

  return sortedChangedA.every((v, i) => {
    const other = sortedChangedB[i];
    return (
      other !== undefined &&
      v.scope === other.scope &&
      v.from === other.from &&
      v.to === other.to
    );
  });
}
