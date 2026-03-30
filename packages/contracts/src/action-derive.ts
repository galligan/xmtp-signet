import type { ActionSpec, HttpSurface } from "./action-spec.js";

/** Supported HTTP methods for derived Signet action routes. */
export type HttpMethod = NonNullable<HttpSurface["method"]>;

/** Where an HTTP adapter should source the parsed action input. */
export type HttpInputSource = "query" | "body";

/** MCP annotations derived from authored action semantics. */
export interface McpAnnotations {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
  readonly idempotentHint?: boolean;
  readonly title?: string;
  readonly [key: string]: unknown;
}

type ActionLike = Pick<
  ActionSpec<unknown, unknown>,
  "cli" | "description" | "http" | "id" | "idempotent" | "intent" | "mcp"
>;

const DEFAULT_HTTP_BASE_PATH = "/v1/actions";

const normalizeBasePath = (basePath: string): string => {
  const trimmed = basePath.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
};

const normalizePath = (path: string): string => {
  const trimmed = path.trim();
  if (trimmed === "") {
    return "/";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/");
};

/** Derive a CLI command name from an action spec. */
export function deriveCliCommand(spec: Pick<ActionLike, "cli" | "id">): string {
  return spec.cli?.command ?? spec.id.replaceAll(".", ":");
}

/** Derive the canonical RPC method for an action. */
export function deriveRpcMethod(spec: Pick<ActionLike, "id">): string {
  return spec.id;
}

/** Derive the standard MCP safety/title annotations. */
export function deriveStandardMcpAnnotations(
  spec: Pick<ActionLike, "description" | "idempotent" | "intent">,
): McpAnnotations {
  const annotations: Record<string, unknown> = {};
  const intent = spec.intent ?? "write";

  if (intent === "read") {
    annotations["readOnlyHint"] = true;
  }
  if (intent === "destroy") {
    annotations["destructiveHint"] = true;
  }
  if (spec.idempotent === true) {
    annotations["idempotentHint"] = true;
  }
  if (spec.description !== undefined) {
    annotations["title"] = spec.description;
  }

  return annotations as McpAnnotations;
}

/** Derive the MCP tool name for an action. */
export function deriveMcpToolName(
  spec: Pick<ActionLike, "id" | "mcp">,
  prefix = "signet",
): string {
  return spec.mcp?.toolName ?? `${prefix}/${spec.id.replaceAll(".", "/")}`;
}

/** Derive the full MCP annotation set for an action. */
export function deriveMcpAnnotations(spec: ActionLike): McpAnnotations {
  return {
    ...spec.mcp?.annotations,
    ...deriveStandardMcpAnnotations(spec),
  };
}

/** Derive the HTTP method for an action. */
export function deriveHttpMethod(
  spec: Pick<ActionLike, "http" | "intent">,
): HttpMethod {
  if (spec.http?.method !== undefined) {
    return spec.http.method;
  }

  return spec.intent === "read" ? "GET" : "POST";
}

/** Derive the HTTP path for an action. */
export function deriveHttpPath(
  spec: Pick<ActionLike, "http" | "id">,
  basePath: string = DEFAULT_HTTP_BASE_PATH,
): string {
  if (spec.http?.path !== undefined) {
    return normalizePath(spec.http.path);
  }

  const normalizedBase = normalizeBasePath(basePath);
  const suffix = spec.id.replaceAll(".", "/");
  return normalizePath(`${normalizedBase}/${suffix}`);
}

/** Derive the request input source for an HTTP method or action. */
export function deriveHttpInputSource(
  methodOrSpec: HttpMethod | Pick<ActionLike, "http" | "intent">,
): HttpInputSource {
  const method: HttpMethod =
    typeof methodOrSpec === "string"
      ? methodOrSpec
      : deriveHttpMethod(methodOrSpec);

  return method === "GET" ? "query" : "body";
}
