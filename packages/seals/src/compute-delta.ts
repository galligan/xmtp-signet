import type {
  SealPayloadType,
  SealDeltaType,
  PermissionScopeType,
} from "@xmtp/signet-schemas";

/**
 * Computes a SealDeltaType between two seal payloads by comparing
 * their permission scope sets. Used to determine whether a policy
 * change is material enough to warrant a new seal.
 */
export function computePayloadDelta(
  previous: SealPayloadType,
  next: SealPayloadType,
): SealDeltaType {
  const prevAllow = new Set<PermissionScopeType>(previous.permissions.allow);
  const nextAllow = new Set<PermissionScopeType>(next.permissions.allow);
  const prevDeny = new Set<PermissionScopeType>(previous.permissions.deny);
  const nextDeny = new Set<PermissionScopeType>(next.permissions.deny);

  const added: PermissionScopeType[] = [];
  const removed: PermissionScopeType[] = [];
  const changed: Array<{
    scope: PermissionScopeType;
    from: "allow" | "deny";
    to: "allow" | "deny";
  }> = [];

  // Scopes newly allowed (not in previous allow set)
  for (const scope of nextAllow) {
    if (!prevAllow.has(scope)) {
      if (prevDeny.has(scope)) {
        // Was explicitly denied, now allowed
        changed.push({ scope, from: "deny", to: "allow" });
      } else {
        added.push(scope);
      }
    }
  }

  // Scopes removed from allow (were allowed, no longer)
  for (const scope of prevAllow) {
    if (!nextAllow.has(scope)) {
      if (nextDeny.has(scope)) {
        // Now explicitly denied
        changed.push({ scope, from: "allow", to: "deny" });
      } else {
        removed.push(scope);
      }
    }
  }

  // Scopes that stay listed in allow but toggle deny state still change the
  // effective permission because deny wins over allow.
  for (const scope of nextDeny) {
    if (!prevDeny.has(scope) && prevAllow.has(scope) && nextAllow.has(scope)) {
      changed.push({ scope, from: "allow", to: "deny" });
    }
  }

  for (const scope of prevDeny) {
    if (!nextDeny.has(scope) && prevAllow.has(scope) && nextAllow.has(scope)) {
      changed.push({ scope, from: "deny", to: "allow" });
    }
  }

  // Scopes newly denied that weren't in previous allow
  // (were not mentioned, now explicitly denied)
  for (const scope of nextDeny) {
    if (!prevDeny.has(scope) && !prevAllow.has(scope)) {
      removed.push(scope);
    }
  }

  // Scopes removed from deny that aren't in next allow
  // (were denied, now not mentioned at all -- effectively removed restriction)
  for (const scope of prevDeny) {
    if (!nextDeny.has(scope) && !nextAllow.has(scope)) {
      added.push(scope);
    }
  }

  return { added, removed, changed };
}
