import type { BrokerError } from "@xmtp-broker/schemas";
import type { Result } from "better-result";
import type { z } from "zod";
import type { AdminClient } from "../admin/client.js";
import {
  createWithDaemonClient,
  parseJsonInput as parseJsonInputImpl,
  type DaemonCommandContext,
  type DaemonCommandDeps,
} from "./daemon-client.js";

export type { DaemonCommandContext, DaemonCommandDeps };

export function parseJsonInput<T>(
  input: string,
  schema: z.ZodType<T>,
  field: string,
): Promise<Result<T, BrokerError>> {
  return parseJsonInputImpl(input, field, schema);
}

export async function withDaemonClient<T>(
  options: { config?: string | undefined },
  deps: Partial<DaemonCommandDeps>,
  run: (
    client: AdminClient,
    context: DaemonCommandContext,
  ) => Promise<Result<T, BrokerError>>,
): Promise<Result<T, BrokerError>> {
  return createWithDaemonClient(deps)(
    {
      configPath: options.config,
    },
    run,
  );
}
