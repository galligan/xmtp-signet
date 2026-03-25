import { z } from "zod";

/** Zod enum of the six permission scope categories. */
export const ScopeCategory: z.ZodEnum<
  [
    "messaging",
    "group-management",
    "metadata",
    "access",
    "observation",
    "egress",
  ]
> = z.enum([
  "messaging",
  "group-management",
  "metadata",
  "access",
  "observation",
  "egress",
]);

/** A permission scope category name. */
export type ScopeCategoryType = z.infer<typeof ScopeCategory>;

const PERMISSION_SCOPE_VALUES = [
  // messaging
  "send",
  "reply",
  "react",
  "read-receipt",
  "attachment",
  // group-management
  "add-member",
  "remove-member",
  "promote-admin",
  "demote-admin",
  "update-permission",
  // metadata
  "update-name",
  "update-description",
  "update-image",
  // access
  "invite",
  "join",
  "leave",
  "create-group",
  "create-dm",
  // observation
  "read-messages",
  "read-history",
  "list-members",
  "list-conversations",
  "read-permissions",
  "stream-messages",
  "stream-conversations",
  // egress
  "forward-to-provider",
  "store-excerpts",
  "use-for-memory",
  "quote-revealed",
  "summarize",
] as const;

/** Zod enum of all 30 permission scope strings (kebab-case). */
export const PermissionScope: z.ZodEnum<
  [
    "send",
    "reply",
    "react",
    "read-receipt",
    "attachment",
    "add-member",
    "remove-member",
    "promote-admin",
    "demote-admin",
    "update-permission",
    "update-name",
    "update-description",
    "update-image",
    "invite",
    "join",
    "leave",
    "create-group",
    "create-dm",
    "read-messages",
    "read-history",
    "list-members",
    "list-conversations",
    "read-permissions",
    "stream-messages",
    "stream-conversations",
    "forward-to-provider",
    "store-excerpts",
    "use-for-memory",
    "quote-revealed",
    "summarize",
  ]
> = z.enum(PERMISSION_SCOPE_VALUES);

/** A single permission scope identifier. */
export type PermissionScopeType = z.infer<typeof PermissionScope>;

/**
 * Maps each scope category to its constituent permission scopes.
 *
 * Every scope belongs to exactly one category. The union of all
 * values covers all 30 scopes with no duplicates.
 */
export const SCOPES_BY_CATEGORY: Record<
  ScopeCategoryType,
  readonly PermissionScopeType[]
> = {
  messaging: ["send", "reply", "react", "read-receipt", "attachment"],
  "group-management": [
    "add-member",
    "remove-member",
    "promote-admin",
    "demote-admin",
    "update-permission",
  ],
  metadata: ["update-name", "update-description", "update-image"],
  access: ["invite", "join", "leave", "create-group", "create-dm"],
  observation: [
    "read-messages",
    "read-history",
    "list-members",
    "list-conversations",
    "read-permissions",
    "stream-messages",
    "stream-conversations",
  ],
  egress: [
    "forward-to-provider",
    "store-excerpts",
    "use-for-memory",
    "quote-revealed",
    "summarize",
  ],
};

/**
 * Zod schema for a scope set with explicit allow and deny lists.
 *
 * Deny always wins: a scope present in both `allow` and `deny`
 * is effectively denied.
 */
/** An allow/deny scope set for a credential. */
export type ScopeSetType = {
  allow: PermissionScopeType[];
  deny: PermissionScopeType[];
};

/** Zod schema for {@link ScopeSetType}. */
export const ScopeSet: z.ZodType<ScopeSetType> = z
  .object({
    allow: z.array(PermissionScope).describe("Scopes explicitly granted"),
    deny: z
      .array(PermissionScope)
      .describe("Scopes explicitly denied (overrides allow)"),
  })
  .describe("Allow/deny scope set for a credential");

/**
 * Resolves a scope set to the effective set of allowed scopes.
 *
 * A scope is effective if it appears in `allow` AND does NOT
 * appear in `deny`. Deny always wins.
 */
export function resolveScopeSet(
  scopeSet: ScopeSetType,
): Set<PermissionScopeType> {
  const denied = new Set<PermissionScopeType>(scopeSet.deny);
  const result = new Set<PermissionScopeType>();
  for (const scope of scopeSet.allow) {
    if (!denied.has(scope)) {
      result.add(scope);
    }
  }
  return result;
}

/**
 * Checks whether a specific scope is present in a resolved set.
 *
 * @param scope - The permission scope to check.
 * @param resolved - A resolved set from {@link resolveScopeSet}.
 * @returns `true` if the scope is effectively allowed.
 */
export function isScopeAllowed(
  scope: PermissionScopeType,
  resolved: ReadonlySet<PermissionScopeType>,
): boolean {
  return resolved.has(scope);
}

/**
 * Checks whether a scope belongs to the given category.
 *
 * @param scope - The permission scope to check.
 * @param category - The category to test membership against.
 * @returns `true` if the scope is listed under the category.
 */
export function isScopeInCategory(
  scope: PermissionScopeType,
  category: ScopeCategoryType,
): boolean {
  const scopes = SCOPES_BY_CATEGORY[category];
  return (scopes as readonly string[]).includes(scope);
}
