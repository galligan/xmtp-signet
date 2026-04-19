import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
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
  AdapterManifest.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../adapter-manifest.json", import.meta.url)),
        "utf-8",
      ),
    ),
  );

function resolveOpenClawAdapterEntryFile(): string {
  const sourceEntrypoint = fileURLToPath(new URL("./bin.ts", import.meta.url));
  if (existsSync(sourceEntrypoint)) {
    return sourceEntrypoint;
  }

  return fileURLToPath(new URL("./bin.js", import.meta.url));
}

/** Process-backed registration exported to the CLI's built-in registry. */
export const openclawAdapterDefinition: OpenClawAdapterDefinition = {
  manifest: OPENCLAW_ADAPTER_MANIFEST,
  command: "bun",
  args: [resolveOpenClawAdapterEntryFile()],
};
