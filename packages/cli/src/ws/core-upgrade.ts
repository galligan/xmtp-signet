import { Result } from "better-result";
import { InternalError, type BrokerError } from "@xmtp-broker/schemas";
import type { BrokerCore } from "@xmtp-broker/contracts";

type UpgradeableCore = Pick<BrokerCore, "state" | "initialize">;

export function createLazyCoreUpgrade(
  core: UpgradeableCore,
): () => Promise<Result<void, BrokerError>> {
  let initializePromise: Promise<Result<void, BrokerError>> | null = null;

  return async (): Promise<Result<void, BrokerError>> => {
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
        InternalError.create("Broker core is not ready to service requests", {
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
