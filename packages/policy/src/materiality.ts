import type { PolicyDelta } from "@xmtp/signet-contracts";

/** Material field prefixes that trigger seal rotation. */
const MATERIAL_FIELD_PREFIXES = [
  "view.mode",
  "view.threadScopes",
  "view.contentTypes",
  "grant.messaging",
  "grant.groupManagement",
  "grant.tools",
  "grant.egress",
] as const;

/** View mode ordering from narrow to broad. */
const VIEW_MODE_ORDER: Record<string, number> = {
  "reveal-only": 0,
  "summary-only": 1,
  redacted: 2,
  "thread-only": 3,
  full: 4,
};

/** Fields where false -> true is a privilege escalation. */
const ESCALATION_FIELD_PREFIXES = [
  "grant.egress",
  "grant.groupManagement",
  "grant.messaging",
  "grant.tools",
] as const;

function isMaterialField(field: string): boolean {
  return MATERIAL_FIELD_PREFIXES.some((prefix) => field.startsWith(prefix));
}

/**
 * Classifies whether any delta in a set of policy changes is material
 * (triggers a new seal) or routine (silent).
 */
export function isMaterialChange(deltas: readonly PolicyDelta[]): boolean {
  return deltas.some((delta) => isSingleDeltaMaterial(delta));
}

function isSingleDeltaMaterial(delta: PolicyDelta): boolean {
  // Content type changes are always material
  if (
    delta.contentTypeChanges.added.length > 0 ||
    delta.contentTypeChanges.removed.length > 0
  ) {
    return true;
  }

  // Check view changes
  for (const change of delta.viewChanges) {
    if (isMaterialField(change.field)) {
      return true;
    }
  }

  // Check grant changes
  for (const change of delta.grantChanges) {
    if (isMaterialField(change.field)) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies whether any delta in a set of policy changes requires
 * session reauthorization (privilege escalation).
 *
 * Stricter subset of material changes: only escalations
 * (expanding from false to true or from narrower to broader mode).
 */
export function requiresReauthorization(
  deltas: readonly PolicyDelta[],
): boolean {
  return deltas.some((delta) => isSingleDeltaEscalation(delta));
}

function isSingleDeltaEscalation(delta: PolicyDelta): boolean {
  // Check view mode escalation
  for (const change of delta.viewChanges) {
    if (change.field === "view.mode") {
      if (typeof change.from === "string" && typeof change.to === "string") {
        const oldOrder = VIEW_MODE_ORDER[change.from];
        const newOrder = VIEW_MODE_ORDER[change.to];
        if (
          oldOrder !== undefined &&
          newOrder !== undefined &&
          newOrder > oldOrder
        ) {
          return true;
        }
      }
    }
  }

  // Check grant escalations (false -> true)
  for (const change of delta.grantChanges) {
    if (change.field === "grant.tools.scopes") {
      if (hasToolScopeEscalation(change.from, change.to)) {
        return true;
      }
      continue;
    }

    const isEscalationField = ESCALATION_FIELD_PREFIXES.some((prefix) =>
      change.field.startsWith(prefix),
    );
    if (
      isEscalationField &&
      change.field !== "grant.messaging.draftOnly" &&
      change.from === false &&
      change.to === true
    ) {
      return true;
    }
  }

  return false;
}

function hasToolScopeEscalation(from: unknown, to: unknown): boolean {
  if (!Array.isArray(to)) {
    return false;
  }

  const previousAllowed = new Map<string, boolean>();
  if (Array.isArray(from)) {
    for (const scope of from) {
      if (
        scope &&
        typeof scope === "object" &&
        "toolId" in scope &&
        typeof scope.toolId === "string" &&
        "allowed" in scope &&
        typeof scope.allowed === "boolean"
      ) {
        previousAllowed.set(scope.toolId, scope.allowed);
      }
    }
  }

  for (const scope of to) {
    if (
      scope &&
      typeof scope === "object" &&
      "toolId" in scope &&
      typeof scope.toolId === "string" &&
      "allowed" in scope &&
      typeof scope.allowed === "boolean" &&
      scope.allowed &&
      previousAllowed.get(scope.toolId) !== true
    ) {
      return true;
    }
  }

  return false;
}
