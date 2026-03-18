import type { SignetError } from "@xmtp/signet-schemas";
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

/**
 * Parse a JSON CLI flag value with the shared daemon-command validation path.
 */
export function parseJsonInput<T>(
  input: string,
  schema: z.ZodType<T>,
  field: string,
): Promise<Result<T, SignetError>> {
  return parseJsonInputImpl(input, field, schema);
}

/**
 * Resolve daemon connection context from command options, then run an RPC body
 * with an authenticated admin client.
 */
export async function withDaemonClient<T>(
  options: { config?: string | undefined },
  deps: Partial<DaemonCommandDeps>,
  run: (
    client: AdminClient,
    context: DaemonCommandContext,
  ) => Promise<Result<T, SignetError>>,
): Promise<Result<T, SignetError>> {
  return createWithDaemonClient(deps)(
    {
      configPath: options.config,
    },
    run,
  );
}
