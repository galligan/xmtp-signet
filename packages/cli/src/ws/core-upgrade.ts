import { Result } from "better-result";
import { InternalError, type SignetError } from "@xmtp/signet-schemas";
import type { SignetCore } from "@xmtp/signet-contracts";

type UpgradeableCore = Pick<SignetCore, "state" | "initialize">;

/**
 * Create a lazy initializer that upgrades the core only when WS traffic needs it.
 */
export function createLazyCoreUpgrade(
  core: UpgradeableCore,
): () => Promise<Result<void, SignetError>> {
  let initializePromise: Promise<Result<void, SignetError>> | null = null;

  return async (): Promise<Result<void, SignetError>> => {
    if (core.state === "ready") {
      return Result.ok(undefined);
    }

    if (initializePromise !== null) {
      return initializePromise;
    }

    if (
      core.state !== "ready-local" &&
      core.state !== "error" &&
      core.state !== "uninitialized"
    ) {
      return Result.err(
        InternalError.create("Signet core is not ready to service requests", {
          coreState: core.state,
        }),
      );
    }

    initializePromise = core.initialize().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  };
}
