import type { PolicyDelta } from "@xmtp/signet-contracts";
import type { SealInput } from "./build.js";

/**
 * Computes a PolicyDelta between a previous and new SealInput.
 * Used to determine whether a policy change is material enough
 * to warrant a new seal.
 */
export function computeInputDelta(
  previous: SealInput,
  next: SealInput,
): PolicyDelta {
  const viewChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  const grantChanges: Array<{ field: string; from: unknown; to: unknown }> = [];
  const added: string[] = [];
  const removed: string[] = [];

  // View mode
  if (previous.view.mode !== next.view.mode) {
    viewChanges.push({
      field: "view.mode",
      from: previous.view.mode,
      to: next.view.mode,
    });
  }

  // Thread scopes (compare serialized form)
  const prevScopes = JSON.stringify(previous.view.threadScopes);
  const nextScopes = JSON.stringify(next.view.threadScopes);
  if (prevScopes !== nextScopes) {
    viewChanges.push({
      field: "view.threadScopes",
      from: previous.view.threadScopes,
      to: next.view.threadScopes,
    });
  }

  // Content types
  const prevTypes = new Set(previous.view.contentTypes);
  const nextTypes = new Set(next.view.contentTypes);
  for (const ct of nextTypes) {
    if (!prevTypes.has(ct)) {
      added.push(ct);
    }
  }
  for (const ct of prevTypes) {
    if (!nextTypes.has(ct)) {
      removed.push(ct);
    }
  }

  // Grant: messaging
  for (const key of Object.keys(
    previous.grant.messaging,
  ) as (keyof typeof previous.grant.messaging)[]) {
    if (previous.grant.messaging[key] !== next.grant.messaging[key]) {
      grantChanges.push({
        field: `grant.messaging.${key}`,
        from: previous.grant.messaging[key],
        to: next.grant.messaging[key],
      });
    }
  }

  // Grant: groupManagement
  for (const key of Object.keys(
    previous.grant.groupManagement,
  ) as (keyof typeof previous.grant.groupManagement)[]) {
    if (
      previous.grant.groupManagement[key] !== next.grant.groupManagement[key]
    ) {
      grantChanges.push({
        field: `grant.groupManagement.${key}`,
        from: previous.grant.groupManagement[key],
        to: next.grant.groupManagement[key],
      });
    }
  }

  // Grant: tools scopes
  const prevTools = JSON.stringify(previous.grant.tools.scopes);
  const nextTools = JSON.stringify(next.grant.tools.scopes);
  if (prevTools !== nextTools) {
    grantChanges.push({
      field: "grant.tools.scopes",
      from: previous.grant.tools.scopes,
      to: next.grant.tools.scopes,
    });
  }

  // Grant: egress
  for (const key of Object.keys(
    previous.grant.egress,
  ) as (keyof typeof previous.grant.egress)[]) {
    if (previous.grant.egress[key] !== next.grant.egress[key]) {
      grantChanges.push({
        field: `grant.egress.${key}`,
        from: previous.grant.egress[key],
        to: next.grant.egress[key],
      });
    }
  }

  return {
    viewChanges,
    grantChanges,
    contentTypeChanges: { added, removed },
  };
}
