import {
  AdapterStatusResult,
  type AdapterStatusResultType,
} from "@xmtp/signet-schemas";
import { OPENCLAW_BRIDGE_PHASE } from "../bridge/index.js";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";

/** Stub doctor result for the scaffold branch. */
export function runOpenClawDoctor(): AdapterStatusResultType {
  return AdapterStatusResult.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    adapterSource: "builtin",
    status: "missing",
    details: {
      phase: "scaffold",
      bridgePhase: OPENCLAW_BRIDGE_PHASE,
      diagnostics: [
        "Provisioning is not implemented on this branch yet.",
        "Read-only bridge work lands on the follow-on bridge branch.",
      ],
    },
  });
}
