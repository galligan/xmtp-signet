import type { SignetError } from "@xmtp/signet-schemas";
import {
  deriveCliCommand,
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpPath,
  deriveMcpAnnotations,
  deriveMcpToolName,
  deriveRpcMethod,
} from "./action-derive.js";
import {
  ACTION_SURFACES,
  type ActionSpec,
  type ActionSurface,
} from "./action-spec.js";

type AnyActionSpec = ActionSpec<unknown, unknown, SignetError>;

/** Deterministic summary of the public Signet action surface. */
export interface ActionSurfaceMap {
  readonly version: "1.0";
  readonly generatedAt: string;
  readonly entries: readonly ActionSurfaceMapEntry[];
}

/** One normalized action entry within the surface map. */
export interface ActionSurfaceMapEntry {
  readonly id: string;
  readonly description?: string;
  readonly intent: "read" | "write" | "destroy";
  readonly idempotent?: true;
  readonly exampleCount: number;
  readonly surfaces: readonly ActionSurface[];
  readonly cli?: {
    readonly command: string;
    readonly rpcMethod: string;
    readonly aliases?: readonly string[];
    readonly outputFormat?: "table" | "json" | "text";
    readonly group?: string;
  };
  readonly mcp?: {
    readonly toolName: string;
    readonly annotations: Record<string, unknown>;
  };
  readonly http?: {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly inputSource: "query" | "body";
    readonly auth: "admin" | "credential";
  };
}

const deepSortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(deepSortKeys);
  }

  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toSorted()) {
      sorted[key] = deepSortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }

  return value;
};

const isSurfaceExposed = (
  spec: AnyActionSpec,
  surface: ActionSurface,
): boolean => {
  if (surface === "http") {
    return spec.http !== undefined && spec.http.expose !== false;
  }

  return spec[surface] !== undefined;
};

const getSurfaces = (spec: AnyActionSpec): ActionSurface[] =>
  ACTION_SURFACES.filter((surface) =>
    isSurfaceExposed(spec, surface),
  ).toSorted();

const toEntry = (spec: AnyActionSpec): ActionSurfaceMapEntry => {
  const entry: Record<string, unknown> = {
    exampleCount: spec.examples?.length ?? 0,
    id: spec.id,
    intent: spec.intent ?? "write",
    surfaces: getSurfaces(spec),
  };

  if (spec.description !== undefined) {
    entry["description"] = spec.description;
  }
  if (spec.idempotent === true) {
    entry["idempotent"] = true;
  }
  if (spec.cli !== undefined) {
    entry["cli"] = deepSortKeys({
      command: deriveCliCommand(spec),
      rpcMethod: deriveRpcMethod(spec),
      aliases: spec.cli.aliases,
      outputFormat: spec.cli.outputFormat,
      group: spec.cli.group,
    });
  }
  if (spec.mcp !== undefined) {
    entry["mcp"] = deepSortKeys({
      toolName: deriveMcpToolName(spec),
      annotations: deriveMcpAnnotations(spec),
    });
  }
  if (spec.http !== undefined && spec.http.expose !== false) {
    const method = deriveHttpMethod(spec);
    entry["http"] = deepSortKeys({
      method,
      path: deriveHttpPath(spec),
      inputSource: deriveHttpInputSource(method),
      auth: spec.http.auth,
    });
  }

  return deepSortKeys(entry) as ActionSurfaceMapEntry;
};

/** Generate a deterministic action surface map from a set of action specs. */
export function generateActionSurfaceMap(
  specs: readonly AnyActionSpec[],
): ActionSurfaceMap {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    entries: specs.map(toEntry).toSorted((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Compute a stable SHA-256 hash for an action surface map. */
export function hashActionSurfaceMap(surfaceMap: ActionSurfaceMap): string {
  const { generatedAt: _generatedAt, ...rest } = surfaceMap;
  const canonical = deepSortKeys(rest);
  const json = JSON.stringify(canonical);
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(json);
  return hasher.digest("hex");
}
