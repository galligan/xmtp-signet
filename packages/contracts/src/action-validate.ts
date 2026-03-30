import { Result } from "better-result";
import { ValidationError } from "@xmtp/signet-schemas";
import type { ActionSpec, ActionSurface, HttpSurface } from "./action-spec.js";
import {
  deriveHttpMethod,
  deriveHttpPath,
  deriveStandardMcpAnnotations,
} from "./action-derive.js";

type AnyActionSpec = ActionSpec<unknown, unknown>;

/** Structured contract validation issue for an action spec registry. */
export interface ActionContractIssue {
  readonly actionId: string;
  readonly rule: string;
  readonly message: string;
  readonly surface?: ActionSurface | "registry";
}

const STANDARD_MCP_ANNOTATION_KEYS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "title",
] as const;

const STANDARD_BOOLEAN_MCP_ANNOTATION_KEYS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
] as const;

const isHttpExposed = (spec: AnyActionSpec): boolean =>
  spec.http !== undefined && spec.http.expose !== false;

const RESERVED_HTTP_ROUTE_PREFIXES = ["/v1/admin/", "/v1/credential/"] as const;
const RESERVED_HTTP_ROUTE_PATHS = ["/v1/health"] as const;

const validateUniqueIds = (
  specs: readonly AnyActionSpec[],
): ActionContractIssue[] => {
  const issues: ActionContractIssue[] = [];
  const seen = new Set<string>();

  for (const spec of specs) {
    if (seen.has(spec.id)) {
      issues.push({
        actionId: spec.id,
        message: `Action '${spec.id}' is registered more than once`,
        rule: "unique-action-id",
        surface: "registry",
      });
      continue;
    }
    seen.add(spec.id);
  }

  return issues;
};

const validateHttpAuth = (
  specs: readonly AnyActionSpec[],
): ActionContractIssue[] => {
  const issues: ActionContractIssue[] = [];

  for (const spec of specs) {
    if (!isHttpExposed(spec)) {
      continue;
    }

    const auth = (spec.http as Partial<HttpSurface> | undefined)?.auth;
    if (auth === undefined) {
      issues.push({
        actionId: spec.id,
        message: `HTTP-exposed action '${spec.id}' must declare http.auth`,
        rule: "http-auth-required",
        surface: "http",
      });
    }
  }

  return issues;
};

const validateUniqueHttpRoutes = (
  specs: readonly AnyActionSpec[],
): ActionContractIssue[] => {
  const issues: ActionContractIssue[] = [];
  const seenRoutes = new Map<string, string>();

  for (const spec of specs) {
    if (!isHttpExposed(spec)) {
      continue;
    }

    const method = deriveHttpMethod(spec);
    const path = deriveHttpPath(spec);
    const routeKey = `${method} ${path}`;
    const existingId = seenRoutes.get(routeKey);

    if (existingId !== undefined) {
      issues.push({
        actionId: spec.id,
        message:
          `Action '${spec.id}' collides with '${existingId}' on derived route ` +
          `${method} ${path}`,
        rule: "unique-http-route",
        surface: "http",
      });
      continue;
    }

    seenRoutes.set(routeKey, spec.id);
  }

  return issues;
};

const validateReservedHttpRoutes = (
  specs: readonly AnyActionSpec[],
): ActionContractIssue[] => {
  const issues: ActionContractIssue[] = [];

  for (const spec of specs) {
    if (!isHttpExposed(spec)) {
      continue;
    }

    const path = deriveHttpPath(spec);
    const collidesWithPrefix = RESERVED_HTTP_ROUTE_PREFIXES.find((prefix) =>
      path.startsWith(prefix),
    );
    const collidesWithExactPath = RESERVED_HTTP_ROUTE_PATHS.includes(
      path as (typeof RESERVED_HTTP_ROUTE_PATHS)[number],
    );

    if (!collidesWithPrefix && !collidesWithExactPath) {
      continue;
    }

    issues.push({
      actionId: spec.id,
      message: collidesWithPrefix
        ? `Action '${spec.id}' derives reserved HTTP path '${path}' under '${collidesWithPrefix}'`
        : `Action '${spec.id}' derives reserved HTTP path '${path}'`,
      rule: "reserved-http-route",
      surface: "http",
    });
  }

  return issues;
};

const validateMcpAnnotations = (
  specs: readonly AnyActionSpec[],
): ActionContractIssue[] => {
  const issues: ActionContractIssue[] = [];

  for (const spec of specs) {
    const authoredAnnotations = spec.mcp?.annotations;
    if (authoredAnnotations === undefined) {
      continue;
    }

    const derivedAnnotations = deriveStandardMcpAnnotations(spec);

    for (const key of STANDARD_MCP_ANNOTATION_KEYS) {
      if (!(key in authoredAnnotations)) {
        continue;
      }

      const authoredValue = authoredAnnotations[key];
      const derivedValue = derivedAnnotations[key];

      if (
        STANDARD_BOOLEAN_MCP_ANNOTATION_KEYS.includes(
          key as (typeof STANDARD_BOOLEAN_MCP_ANNOTATION_KEYS)[number],
        ) &&
        authoredValue === false &&
        derivedValue === undefined
      ) {
        continue;
      }

      if (authoredValue !== derivedValue) {
        issues.push({
          actionId: spec.id,
          message:
            `Action '${spec.id}' authors MCP annotation '${key}' as ` +
            `${JSON.stringify(authoredValue)}, but the derived value is ` +
            `${JSON.stringify(derivedValue)}`,
          rule: "mcp-annotation-consistency",
          surface: "mcp",
        });
      }
    }
  }

  return issues;
};

/**
 * Validate the structural integrity of a set of ActionSpecs.
 *
 * Collects duplicate IDs, invalid surfaced actions, derived HTTP route
 * collisions, and contradictions between authored MCP annotations and the
 * canonical derived semantics.
 */
export function validateActionSpecs(
  specs: readonly AnyActionSpec[],
): Result<void, ValidationError> {
  const issues = [
    ...validateUniqueIds(specs),
    ...validateHttpAuth(specs),
    ...validateUniqueHttpRoutes(specs),
    ...validateReservedHttpRoutes(specs),
    ...validateMcpAnnotations(specs),
  ];

  if (issues.length === 0) {
    return Result.ok(undefined);
  }

  return Result.err(
    ValidationError.create(
      "actionRegistry",
      "Action contract validation failed",
      {
        issues,
      },
    ),
  );
}
