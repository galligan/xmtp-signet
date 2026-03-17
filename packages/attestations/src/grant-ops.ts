import type { GrantConfig } from "@xmtp-broker/schemas";

/**
 * Converts a structured GrantConfig into the flat string array stored
 * in attestation.grantedOps. This is the canonical mapping.
 */
export function grantConfigToOps(grant: GrantConfig): readonly string[] {
  const ops: string[] = [];

  // Messaging grants
  if (grant.messaging.send) ops.push("messaging:send");
  if (grant.messaging.reply) ops.push("messaging:reply");
  if (grant.messaging.react) ops.push("messaging:react");
  if (grant.messaging.draftOnly) ops.push("messaging:draft_only");

  // Group management grants
  if (grant.groupManagement.addMembers) ops.push("group:add_members");
  if (grant.groupManagement.removeMembers) ops.push("group:remove_members");
  if (grant.groupManagement.updateMetadata) ops.push("group:update_metadata");
  if (grant.groupManagement.inviteUsers) ops.push("group:invite_users");

  // Egress grants
  if (grant.egress.storeExcerpts) ops.push("egress:store_excerpts");
  if (grant.egress.useForMemory) ops.push("egress:use_for_memory");
  if (grant.egress.forwardToProviders) ops.push("egress:forward_to_providers");
  if (grant.egress.quoteRevealed) ops.push("egress:quote_revealed");
  if (grant.egress.summarize) ops.push("egress:summarize");

  return ops;
}

/**
 * Converts a GrantConfig's tool scopes into the flat string array
 * stored in attestation.toolScopes. Only includes allowed tools.
 */
export function grantConfigToToolScopes(grant: GrantConfig): readonly string[] {
  return grant.tools.scopes
    .filter((scope) => scope.allowed)
    .map((scope) => scope.toolId);
}
