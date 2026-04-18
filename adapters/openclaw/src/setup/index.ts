import {
  AdapterSetupResult,
  type AdapterSetupResultType,
} from "@xmtp/signet-schemas";
import { listOpenClawArtifactFiles } from "../artifacts/index.js";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";

/** Stub setup result for the scaffold branch. */
export function runOpenClawSetup(): AdapterSetupResultType {
  return AdapterSetupResult.parse({
    adapter: OPENCLAW_ADAPTER_NAME,
    adapterSource: "builtin",
    status: "missing",
    created: [],
    reused: [],
    artifacts: Object.fromEntries(
      listOpenClawArtifactFiles().map((file) => [file, "pending"]),
    ),
    nextSteps: [
      "Implement provisioning and artifact generation on the next branch.",
    ],
  });
}
