import { z } from "zod";

/** Reconnection settings (all fields have defaults). */
export type ReconnectOptions = {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
};

/** Input type for reconnect options (all optional with defaults). */
type ReconnectOptionsInput = {
  enabled?: boolean | undefined;
  maxAttempts?: number | undefined;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  jitter?: boolean | undefined;
};

/** Parsed signet handler configuration (all defaults applied). */
export type SignetHandlerConfig = {
  url: string;
  token: string;
  reconnect: ReconnectOptions;
  requestTimeoutMs: number;
};

/** Input to SignetHandlerConfigSchema (fields with defaults are optional). */
type SignetHandlerConfigInput = {
  url: string;
  token: string;
  reconnect?: ReconnectOptionsInput | undefined;
  requestTimeoutMs?: number | undefined;
};

/** Signet handler configuration schema. Validates harness-provided config. */
export const SignetHandlerConfigSchema: z.ZodType<
  SignetHandlerConfig,
  z.ZodTypeDef,
  SignetHandlerConfigInput
> = z
  .object({
    url: z
      .string()
      .url()
      .describe("Signet WebSocket URL (e.g., ws://localhost:8393/v1/agent)"),
    token: z
      .string()
      .min(1)
      .describe("Credential bearer token obtained from signet admin"),
    reconnect: z
      .object({
        enabled: z
          .boolean()
          .default(true)
          .describe("Enable automatic reconnection"),
        maxAttempts: z
          .number()
          .int()
          .nonnegative()
          .default(10)
          .describe("Maximum reconnection attempts (0 = unlimited)"),
        baseDelayMs: z
          .number()
          .int()
          .positive()
          .default(1_000)
          .describe("Base delay for exponential backoff"),
        maxDelayMs: z
          .number()
          .int()
          .positive()
          .default(30_000)
          .describe("Maximum delay between reconnection attempts"),
        jitter: z
          .boolean()
          .default(true)
          .describe("Add random jitter to backoff delays"),
      })
      .default({})
      .describe("Reconnection settings"),
    requestTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe("Timeout for individual request/response round-trips"),
  })
  .describe("Signet handler configuration");
