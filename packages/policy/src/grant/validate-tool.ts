import { Result } from "better-result";
import { type GrantConfig, GrantDeniedError } from "@xmtp/signet-schemas";
import type { GrantError } from "@xmtp/signet-contracts";

/** Deep structural equality for constraint matching. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => k in bObj && deepEqual(aObj[k], bObj[k]));
}

/**
 * Validates a tool invocation against the active grant.
 *
 * The toolId must appear in grant.tools.scopes with allowed: true.
 * If the scope has non-null parameter constraints:
 * - Request parameters present in the constraint must match exactly (deep equality)
 * - Request parameters NOT in the constraint are rejected (allowlist semantics)
 * - Constraint keys not present in the request are allowed (optional params)
 */
export function validateToolUse(
  toolId: string,
  parameters: Record<string, unknown> | null,
  grant: GrantConfig,
): Result<void, GrantError> {
  const scope = grant.tools.scopes.find((s) => s.toolId === toolId);

  if (!scope || !scope.allowed) {
    return Result.err(
      GrantDeniedError.create(`tool:${toolId}`, "tools.scopes"),
    );
  }

  // null constraints = unconstrained, any params accepted
  if (scope.parameters === null) {
    return Result.ok();
  }

  const constraints = scope.parameters;

  // Reject request keys not in the constraint allowlist
  if (parameters !== null) {
    for (const key of Object.keys(parameters)) {
      if (!(key in constraints)) {
        return Result.err(
          GrantDeniedError.create(
            `tool:${toolId}.${key}`,
            "tools.scopes.parameters",
          ),
        );
      }
    }
  }

  // For constrained keys present in the request, verify deep equality
  for (const [key, required] of Object.entries(constraints)) {
    const actual = parameters?.[key];

    // Constraint key not in request — allowed (optional param)
    if (actual === undefined) continue;

    // Deep equality check — covers primitives, null, nested objects, arrays
    if (!deepEqual(actual, required)) {
      return Result.err(
        GrantDeniedError.create(
          `tool:${toolId}.${key}`,
          "tools.scopes.parameters",
        ),
      );
    }
  }

  return Result.ok();
}
