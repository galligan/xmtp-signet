/**
 * Materiality check logic.
 *
 * Determines whether a policy change between two view/grant
 * configurations constitutes a material escalation (requiring
 * session reauthorization) or a non-material update (applied
 * in-place).
 */

import type { ViewConfig, GrantConfig, ViewMode } from "@xmtp/signet-schemas";
import type { MaterialityCheck } from "@xmtp/signet-contracts";

/** Extended materiality result with changed field names for diagnostics. */
export interface DetailedMaterialityCheck extends MaterialityCheck {
  readonly changedFields: readonly string[];
}

/**
 * View mode access levels, ordered from least to most access.
 * Escalation = moving to a higher index.
 */
const VIEW_MODE_LEVEL: Record<ViewMode, number> = {
  "reveal-only": 0,
  "summary-only": 1,
  redacted: 2,
  "thread-only": 3,
  full: 4,
};

/** Check whether a policy change is material. */
export function checkMateriality(
  oldView: ViewConfig,
  oldGrant: GrantConfig,
  newView: ViewConfig,
  newGrant: GrantConfig,
): DetailedMaterialityCheck {
  const changedFields: string[] = [];

  // View mode escalation
  if (oldView.mode !== newView.mode) {
    const oldLevel = VIEW_MODE_LEVEL[oldView.mode];
    const newLevel = VIEW_MODE_LEVEL[newView.mode];
    if (newLevel > oldLevel) {
      changedFields.push("view.mode");
    }
  }

  // Messaging grant escalation
  checkBoolEscalation(
    oldGrant.messaging.send,
    newGrant.messaging.send,
    "grant.messaging.send",
    changedFields,
  );
  // draftOnly: true -> false is escalation (removing guardrail)
  if (oldGrant.messaging.draftOnly && !newGrant.messaging.draftOnly) {
    changedFields.push("grant.messaging.draftOnly");
  }

  // Group management escalation (any false -> true)
  checkBoolEscalation(
    oldGrant.groupManagement.addMembers,
    newGrant.groupManagement.addMembers,
    "grant.groupManagement.addMembers",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.groupManagement.removeMembers,
    newGrant.groupManagement.removeMembers,
    "grant.groupManagement.removeMembers",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.groupManagement.updateMetadata,
    newGrant.groupManagement.updateMetadata,
    "grant.groupManagement.updateMetadata",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.groupManagement.inviteUsers,
    newGrant.groupManagement.inviteUsers,
    "grant.groupManagement.inviteUsers",
    changedFields,
  );

  // Egress escalation (any false -> true)
  checkBoolEscalation(
    oldGrant.egress.storeExcerpts,
    newGrant.egress.storeExcerpts,
    "grant.egress.storeExcerpts",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.egress.useForMemory,
    newGrant.egress.useForMemory,
    "grant.egress.useForMemory",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.egress.forwardToProviders,
    newGrant.egress.forwardToProviders,
    "grant.egress.forwardToProviders",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.egress.quoteRevealed,
    newGrant.egress.quoteRevealed,
    "grant.egress.quoteRevealed",
    changedFields,
  );
  checkBoolEscalation(
    oldGrant.egress.summarize,
    newGrant.egress.summarize,
    "grant.egress.summarize",
    changedFields,
  );

  // Tool scope escalation
  if (hasToolEscalation(oldGrant.tools.scopes, newGrant.tools.scopes)) {
    changedFields.push("grant.tools.scopes");
  }

  const isMaterial = changedFields.length > 0;
  return {
    isMaterial,
    reason: isMaterial
      ? `Material change in: ${changedFields.join(", ")}`
      : null,
    delta: null,
    changedFields,
  };
}

/** Check if a boolean field escalated from false to true. */
function checkBoolEscalation(
  oldVal: boolean,
  newVal: boolean,
  field: string,
  out: string[],
): void {
  if (!oldVal && newVal) {
    out.push(field);
  }
}

/** Check if any tool scope was added or escalated from disallowed to allowed. */
function hasToolEscalation(
  oldScopes: GrantConfig["tools"]["scopes"],
  newScopes: GrantConfig["tools"]["scopes"],
): boolean {
  const oldMap = new Map(oldScopes.map((s) => [s.toolId, s.allowed]));
  for (const newScope of newScopes) {
    const oldAllowed = oldMap.get(newScope.toolId);
    // New tool added, or existing tool escalated from false to true
    if (oldAllowed === undefined && newScope.allowed) {
      return true;
    }
    if (oldAllowed === false && newScope.allowed) {
      return true;
    }
  }
  return false;
}
