import {
  AdapterStatusResult,
  type AdapterStatusResultType,
} from "@xmtp/signet-schemas";
import { OPENCLAW_BRIDGE_PHASE } from "../bridge/index.js";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";
import {
  inspectOpenClawRuntime,
  type OpenClawRuntimeInspection,
} from "../status/runtime.js";
import type { OpenClawAdapterPathDeps } from "../bridge/config.js";

function diagnosticsForInspection(
  inspection: OpenClawRuntimeInspection,
): readonly string[] {
  if (inspection.status === "ok") {
    return [
      "OpenClaw adapter artifacts are present.",
      "Read-only bridge primitives are available for local delivery.",
    ];
  }

  const diagnostics: string[] = [];
  if (inspection.presence.missingFiles.length > 0) {
    diagnostics.push(
      `Missing artifacts: ${inspection.presence.missingFiles.join(", ")}`,
    );
  }
  if (!inspection.presence.checkpointsDirExists) {
    diagnostics.push("Missing checkpoints directory for bridge replay state.");
  }
  diagnostics.push("Run `xs agent setup openclaw` to provision or repair.");
  return diagnostics;
}

/** Diagnose the current OpenClaw adapter install and bridge prerequisites. */
export async function runOpenClawDoctor(
  options: {
    readonly configPath: string;
  },
  deps: Partial<OpenClawAdapterPathDeps> = {},
): Promise<AdapterStatusResultType> {
  const inspectionResult = await inspectOpenClawRuntime(options, deps);
  if (inspectionResult.isErr()) {
    return AdapterStatusResult.parse({
      adapter: OPENCLAW_ADAPTER_NAME,
      adapterSource: "builtin",
      status: "missing",
      details: {
        phase: "runtime",
        bridgePhase: OPENCLAW_BRIDGE_PHASE,
        diagnostics: [inspectionResult.error.message],
      },
    });
  }

  const inspection = inspectionResult.value;
  return AdapterStatusResult.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    adapterSource: "builtin",
    status: inspection.status,
    details: {
      phase: "runtime",
      bridgePhase: OPENCLAW_BRIDGE_PHASE,
      adapterDir: inspection.presence.adapterDir,
      checkpointsDir: inspection.presence.checkpointsDir,
      diagnostics: diagnosticsForInspection(inspection),
    },
  });
}
