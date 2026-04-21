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

/** Stub status result for the scaffold branch. */
export function runOpenClawStatus(): AdapterStatusResultType {
  return AdapterStatusResult.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    adapterSource: "builtin",
    status: "missing",
    details: {
      phase: "scaffold",
      bridgePhase: OPENCLAW_BRIDGE_PHASE,
      bridgeReady: isOpenClawBridgeReady(),
      expectedArtifacts: listOpenClawArtifactFiles(),
    },
  });
}
