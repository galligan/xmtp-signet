import { z } from "zod";
import { PolicyId } from "./resource-id.js";
import {
  PermissionScope,
  type PermissionScopeType,
  type ScopeSetType,
} from "./permission-scopes.js";

/**
 * Configuration for a reusable permission policy.
 *
 * Policies bundle allow/deny scope lists under a human-readable label
 * so they can be referenced by credentials and reveal flows without repeating
 * individual scopes.
 */
export type PolicyConfigType = {
  label: string;
  allow: PermissionScopeType[];
  deny: PermissionScopeType[];
};

/** Zod schema for {@link PolicyConfigType}. */
export const PolicyConfig: z.ZodType<PolicyConfigType> = z
  .object({
    /** Human-readable name for this policy. */
    label: z.string().min(1),
    /** Scopes explicitly granted by this policy. */
    allow: z.array(PermissionScope),
    /** Scopes explicitly denied by this policy (overrides allow). */
    deny: z.array(PermissionScope),
  })
  .describe("Reusable permission policy configuration");

/**
 * Persisted policy record with identity and timestamps.
 */
export type PolicyRecordType = {
  id: string;
  config: PolicyConfigType;
  createdAt: string;
  updatedAt: string;
};

/** Zod schema for {@link PolicyRecordType}. */
export const PolicyRecord: z.ZodType<PolicyRecordType> = z
  .object({
    /** Unique policy identifier (`policy_` prefix). */
    id: PolicyId,
    /** The policy configuration. */
    config: PolicyConfig,
    /** ISO 8601 creation timestamp. */
    createdAt: z.string().datetime(),
    /** ISO 8601 last-update timestamp. */
    updatedAt: z.string().datetime(),
  })
  .describe("Persisted policy record");

/**
 * Merges a policy's scopes with optional inline overrides into a
 * single {@link ScopeSetType}.
 *
 * The returned object contains the combined allow and deny arrays
 * but does NOT resolve deny-wins precedence. Call
 * {@link resolveScopeSet} on the result to obtain the effective
 * permission set.
 *
 * @param policy - Base policy configuration.
 * @param inlineAllow - Additional scopes to allow beyond the policy.
 * @param inlineDeny - Additional scopes to deny beyond the policy.
 * @returns Merged scope set with concatenated allow and deny lists.
 */
export function resolvePolicy(
  policy: PolicyConfigType,
  inlineAllow?: PermissionScopeType[],
  inlineDeny?: PermissionScopeType[],
): ScopeSetType {
  return {
    allow: [...policy.allow, ...(inlineAllow ?? [])],
    deny: [...policy.deny, ...(inlineDeny ?? [])],
  };
}
