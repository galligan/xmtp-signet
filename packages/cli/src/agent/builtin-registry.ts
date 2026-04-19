import {
  type AdapterManifestType,
  type AdapterVerbType,
} from "@xmtp/signet-schemas";
import { openclawAdapterDefinition } from "@xmtp/openclaw-adapter";

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
const OPENCLAW_DEFINITION = openclawAdapterDefinition;

const builtinAgentAdapters: BuiltinAgentAdapterRegistry = {
  [OPENCLAW_DEFINITION.manifest.name]: OPENCLAW_DEFINITION,
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
