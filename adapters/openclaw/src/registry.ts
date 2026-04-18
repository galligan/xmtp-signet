import { fileURLToPath } from "node:url";
import {
  AdapterManifest,
  type AdapterManifestType,
} from "@xmtp/signet-schemas";

/** Process-backed registration metadata exported by the OpenClaw adapter. */
export interface OpenClawAdapterDefinition {
  readonly manifest: AdapterManifestType;
  readonly command: string;
  readonly args: readonly string[];
}

/** Built-in manifest for the OpenClaw adapter. */
export const OPENCLAW_ADAPTER_MANIFEST: AdapterManifestType =
  AdapterManifest.parse({
    name: "openclaw",
    source: "builtin",
    supports: ["setup", "status", "doctor"],
    entrypoints: {
      setup: "builtin:openclaw:setup",
      status: "builtin:openclaw:status",
      doctor: "builtin:openclaw:doctor",
    },
  });

/** Process-backed registration exported to the CLI's built-in registry. */
export const openclawAdapterDefinition: OpenClawAdapterDefinition = {
  manifest: OPENCLAW_ADAPTER_MANIFEST,
  command: "bun",
  args: [fileURLToPath(new URL("./bin.js", import.meta.url))],
};
