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
 *
 * The initial registry is intentionally sparse; later branches add OpenClaw as
 * the first concrete built-in adapter.
 */
const OPENCLAW_MANIFEST: AdapterManifestType = AdapterManifest.parse({
  name: "openclaw",
  source: "builtin",
  supports: ["setup", "status", "doctor"],
  entrypoints: {
    setup: "builtin:openclaw:setup",
    status: "builtin:openclaw:status",
    doctor: "builtin:openclaw:doctor",
  },
});

const builtinAgentAdapters: BuiltinAgentAdapterRegistry = {
  [OPENCLAW_MANIFEST.name]: {
    manifest: OPENCLAW_MANIFEST,
    command: "bun",
    args: [
      fileURLToPath(
        new URL("../../../../adapters/openclaw/src/bin.ts", import.meta.url),
      ),
    ],
  },
};

/** Returns the current built-in adapter registry. */
export function getBuiltinAgentAdapters(): BuiltinAgentAdapterRegistry {
  return builtinAgentAdapters;
}

/** Read a single built-in adapter registration if present. */
export function getBuiltinAgentAdapter(
  name: string,
): BuiltinAgentAdapterDefinition | undefined {
  return builtinAgentAdapters[name];
}

/** Returns true when the built-in adapter manifest declares the given verb. */
export function builtinAdapterSupportsVerb(
  adapter: BuiltinAgentAdapterDefinition,
  verb: AdapterVerbType,
): boolean {
  return adapter.manifest.supports.includes(verb);
}
