import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AdapterManifest,
  type AdapterManifestType,
  type AdapterVerbType,
} from "@xmtp/signet-schemas";

/** First-party adapter registration known to the CLI. */
export interface BuiltinAgentAdapterDefinition {
  readonly manifest: AdapterManifestType;
  readonly command: string;
  readonly args?: readonly string[] | undefined;
  readonly cwd?: string | undefined;
}

/** Mapping of first-party adapter names to process-backed registrations. */
export type BuiltinAgentAdapterRegistry = Record<
  string,
  BuiltinAgentAdapterDefinition
>;

/**
 * First-party adapter registrations bundled with the repo.
 */
function resolveOpenClawPath(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? "";
}

const openclawManifestPath = resolveOpenClawPath([
  fileURLToPath(
    new URL(
      "../../../../adapters/openclaw/adapter-manifest.json",
      import.meta.url,
    ),
  ),
  fileURLToPath(
    new URL(
      "../../../adapters/openclaw/adapter-manifest.json",
      import.meta.url,
    ),
  ),
]);

const openclawBinPath = resolveOpenClawPath([
  fileURLToPath(
    new URL("../../../../adapters/openclaw/src/bin.ts", import.meta.url),
  ),
  fileURLToPath(
    new URL("../../../adapters/openclaw/src/bin.ts", import.meta.url),
  ),
]);

let builtinAgentAdapters: BuiltinAgentAdapterRegistry | null = null;

function loadOpenClawDefinition(): BuiltinAgentAdapterDefinition | null {
  if (!existsSync(openclawManifestPath) || !existsSync(openclawBinPath)) {
    return null;
  }

  try {
    return {
      manifest: AdapterManifest.parse(
        JSON.parse(readFileSync(openclawManifestPath, "utf-8")),
      ),
      command: "bun",
      args: [openclawBinPath],
    };
  } catch {
    return null;
  }
}

/** Returns the current built-in adapter registry. */
export function getBuiltinAgentAdapters(): BuiltinAgentAdapterRegistry {
  if (builtinAgentAdapters !== null) {
    return builtinAgentAdapters;
  }

  const openclawDefinition = loadOpenClawDefinition();
  builtinAgentAdapters =
    openclawDefinition === null
      ? {}
      : {
          [openclawDefinition.manifest.name]: openclawDefinition,
        };

  return builtinAgentAdapters;
}

/** Read a single built-in adapter registration if present. */
export function getBuiltinAgentAdapter(
  name: string,
): BuiltinAgentAdapterDefinition | undefined {
  return getBuiltinAgentAdapters()[name];
}

/** Returns true when the built-in adapter manifest declares the given verb. */
export function builtinAdapterSupportsVerb(
  adapter: BuiltinAgentAdapterDefinition,
  verb: AdapterVerbType,
): boolean {
  return adapter.manifest.supports.includes(verb);
}
