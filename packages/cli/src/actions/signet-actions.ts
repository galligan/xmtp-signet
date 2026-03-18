import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import type { DaemonStatus } from "../daemon/status.js";

/** Dependencies for the daemon-level `signet:*` CLI actions. */
export interface SignetActionDeps {
  readonly status: () => Promise<DaemonStatus>;
  readonly shutdown: () => Promise<Result<void, SignetError>>;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI actions for daemon status and shutdown. */
export function createSignetActions(
  deps: SignetActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const createStatusSpec = (
    id: string,
    command: string,
    rpcMethod: string,
  ): ActionSpec<Record<string, never>, DaemonStatus, SignetError> => ({
    id,
    input: z.object({}),
    handler: async () => Result.ok(await deps.status()),
    cli: {
      command,
      rpcMethod,
    },
  });

  const createStopSpec = (
    id: string,
    command: string,
    rpcMethod: string,
  ): ActionSpec<
    { force?: boolean | undefined },
    { stopped: true },
    SignetError
  > => ({
    id,
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
      command,
      rpcMethod,
    },
  });

  return [
    widenActionSpec(
      createStatusSpec("signet.status", "signet:status", "signet.status"),
    ),
    widenActionSpec(
      createStopSpec("signet.stop", "signet:stop", "signet.stop"),
    ),
  ];
}
