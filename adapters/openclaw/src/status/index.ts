import {
  AdapterStatusResult,
  type AdapterStatusResultType,
} from "@xmtp/signet-schemas";
import {
  OPENCLAW_BRIDGE_PHASE,
  isOpenClawBridgeReady,
} from "../bridge/index.js";
import { listOpenClawArtifactFiles } from "../artifacts/index.js";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";
import {
  inspectOpenClawRuntime,
  type OpenClawRuntimeInspection,
} from "./runtime.js";
import type { OpenClawAdapterPathDeps } from "../bridge/config.js";

function toStatusResult(
  inspection: OpenClawRuntimeInspection,
): AdapterStatusResultType {
  return AdapterStatusResult.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    adapterSource: "builtin",
    status: inspection.status,
    details: {
      phase: "runtime",
      bridgePhase: OPENCLAW_BRIDGE_PHASE,
      bridgeReady: isOpenClawBridgeReady(),
      expectedArtifacts: listOpenClawArtifactFiles(),
      adapterDir: inspection.presence.adapterDir,
      checkpointsDir: inspection.presence.checkpointsDir,
      checkpointsDirExists: inspection.presence.checkpointsDirExists,
      presentArtifacts: inspection.presence.presentFiles,
      missingArtifacts: inspection.presence.missingFiles,
    },
  });
}

/** Inspect the provisioned OpenClaw adapter plus read-only bridge readiness. */
export async function runOpenClawStatus(
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
        bridgeReady: isOpenClawBridgeReady(),
        error: inspectionResult.error.message,
      },
    });
  }

  return toStatusResult(inspectionResult.value);
}
