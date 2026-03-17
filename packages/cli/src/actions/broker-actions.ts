import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp-broker/contracts";
import type { BrokerError } from "@xmtp-broker/schemas";
import type { DaemonStatus } from "../daemon/status.js";

export interface BrokerActionDeps {
  readonly status: () => Promise<DaemonStatus>;
  readonly shutdown: () => Promise<Result<void, BrokerError>>;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, BrokerError>,
): ActionSpec<unknown, unknown, BrokerError> {
  return spec as ActionSpec<unknown, unknown, BrokerError>;
}

export function createBrokerActions(
  deps: BrokerActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[] {
  const status: ActionSpec<Record<string, never>, DaemonStatus, BrokerError> = {
    id: "broker.status",
    input: z.object({}),
    handler: async () => Result.ok(await deps.status()),
    cli: {
      command: "broker:status",
      rpcMethod: "broker.status",
    },
  };

  const stop: ActionSpec<
    { force?: boolean | undefined },
    { stopped: true },
    BrokerError
  > = {
    id: "broker.stop",
    input: z.object({
      force: z.boolean().optional(),
    }),
    handler: async () => {
      const result = await deps.shutdown();
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok({ stopped: true as const });
    },
    cli: {
      command: "broker:stop",
      rpcMethod: "broker.stop",
    },
  };

  return [widenActionSpec(status), widenActionSpec(stop)];
}
