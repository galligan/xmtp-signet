/**
 * Materiality check logic for scope-based credentials.
 *
 * Determines whether a scope change between two scope sets
 * constitutes a material escalation (requiring reauthorization)
 * or a non-material update (applied in-place).
 *
 * A change is material if any scope was added or moved from
 * deny to allow. Requires reauthorization if scopes were
 * added (escalation).
 */

import type { ScopeSetType, PermissionScopeType } from "@xmtp/signet-schemas";
import type {
  MaterialityCheck,
  PolicyDelta,
} from "@xmtp/signet-contracts";

/** Extended materiality result with policy delta for diagnostics. */
export interface DetailedMaterialityCheck extends MaterialityCheck {
  readonly delta: PolicyDelta;
  readonly requiresReauthorization: boolean;
}

/** Check whether a scope change is material. */
export function checkMateriality(
  oldScopes: ScopeSetType,
  newScopes: ScopeSetType,
): DetailedMaterialityCheck {
  const oldAllowSet = new Set<PermissionScopeType>(oldScopes.allow);
  const oldDenySet = new Set<PermissionScopeType>(oldScopes.deny);
  const newAllowSet = new Set<PermissionScopeType>(newScopes.allow);
  const newDenySet = new Set<PermissionScopeType>(newScopes.deny);

  const added: PermissionScopeType[] = [];
  const removed: PermissionScopeType[] = [];
  const changed: Array<{
    scope: PermissionScopeType;
    from: "allow" | "deny";
    to: "allow" | "deny";
  }> = [];

  const allScopes = new Set<PermissionScopeType>([
    ...oldAllowSet,
    ...oldDenySet,
    ...newAllowSet,
    ...newDenySet,
  ]);

  for (const scope of allScopes) {
    const oldAllowed = oldAllowSet.has(scope) && !oldDenySet.has(scope);
    const newAllowed = newAllowSet.has(scope) && !newDenySet.has(scope);

    if (oldAllowed === newAllowed) {
      continue;
    }

    if (!oldAllowed && newAllowed) {
      if (oldAllowSet.has(scope) || oldDenySet.has(scope)) {
        changed.push({ scope, from: "deny", to: "allow" });
      } else {
        added.push(scope);
      }
      continue;
    }

    if (newDenySet.has(scope)) {
      changed.push({ scope, from: "allow", to: "deny" });
    } else {
      removed.push(scope);
    }
  }

  const delta: PolicyDelta = { added, removed, changed };

  const isMaterial =
    added.length > 0 || removed.length > 0 || changed.length > 0;

  // Requires reauthorization only if scopes were added or escalated
  const escalations = changed.filter((c) => c.to === "allow");
  const requiresReauthorization = added.length > 0 || escalations.length > 0;

  const reason = isMaterial ? buildReason(delta) : null;

  return {
    isMaterial,
    reason,
    delta,
    requiresReauthorization,
  };
}

/** Build a human-readable reason string from a policy delta. */
function buildReason(delta: PolicyDelta): string {
  const parts: string[] = [];
  if (delta.added.length > 0) {
    parts.push(`added: ${delta.added.join(", ")}`);
  }
  if (delta.removed.length > 0) {
    parts.push(`removed: ${delta.removed.join(", ")}`);
  }
  if (delta.changed.length > 0) {
    const descs = delta.changed.map((c) => `${c.scope} (${c.from} -> ${c.to})`);
    parts.push(`changed: ${descs.join(", ")}`);
  }
  return `Material change: ${parts.join("; ")}`;
}
