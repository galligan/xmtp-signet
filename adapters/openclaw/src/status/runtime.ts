import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import {
  inspectOpenClawRuntimePresence,
  type OpenClawAdapterPathDeps,
  type OpenClawRuntimePresence,
} from "../bridge/config.js";
import { listOpenClawArtifactFiles } from "../artifacts/index.js";

/** Shared OpenClaw runtime inspection result used by status and doctor. */
export interface OpenClawRuntimeInspection {
  readonly presence: OpenClawRuntimePresence;
  readonly status: "ok" | "degraded" | "missing";
}

/** Inspect adapter artifacts and derive a normalized runtime status. */
export async function inspectOpenClawRuntime(
  options: {
    readonly configPath: string;
  },
  deps: Partial<OpenClawAdapterPathDeps> = {},
): Promise<Result<OpenClawRuntimeInspection, SignetError>> {
  const presenceResult = await inspectOpenClawRuntimePresence(
    {
      configPath: options.configPath,
      expectedFiles: listOpenClawArtifactFiles(),
    },
    deps,
  );
  if (presenceResult.isErr()) {
    return presenceResult;
  }

  const presence = presenceResult.value;
  const status =
    presence.missingFiles.length === 0 && presence.checkpointsDirExists
      ? "ok"
      : presence.presentFiles.length > 0 || presence.checkpointsDirExists
        ? "degraded"
        : "missing";

  return Result.ok({
    presence,
    status,
  });
}
