import type {
  CredentialConfigType,
  ScopeSetType,
  PermissionScopeType,
} from "@xmtp/signet-schemas";

export const baseScopes: ScopeSetType = {
  allow: ["read-messages", "list-conversations"] as PermissionScopeType[],
  deny: [] as PermissionScopeType[],
};

export const restrictedScopes: ScopeSetType = {
  allow: ["read-messages"] as PermissionScopeType[],
  deny: ["send"] as PermissionScopeType[],
};

export const escalatedScopes: ScopeSetType = {
  allow: [
    "read-messages",
    "list-conversations",
    "send",
    "reply",
  ] as PermissionScopeType[],
  deny: [] as PermissionScopeType[],
};

export function createTestCredentialConfig(
  overrides?: Partial<CredentialConfigType>,
): CredentialConfigType {
  return {
    operatorId: "op_test1234",
    chatIds: ["conv_group1"],
    allow: baseScopes.allow,
    deny: baseScopes.deny,
    ttlSeconds: 3600,
    ...overrides,
  };
}

export function createTestScopes(
  overrides?: Partial<ScopeSetType>,
): ScopeSetType {
  return { ...baseScopes, ...overrides };
}
