import { z } from "zod";

/** Parsed WebSocket server configuration (all defaults applied). */
export type WsServerConfig = {
  port: number;
  host: string;
  heartbeatIntervalMs: number;
  missedHeartbeatsBeforeDead: number;
  authTimeoutMs: number;
  requestTimeoutMs: number;
  replayBufferSize: number;
  sendBufferSoftLimit: number;
  sendBufferHardLimit: number;
  drainTimeoutMs: number;
  maxFrameSizeBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxMessages: number | null;
};

/** Input to WsServerConfigSchema (fields with defaults are optional). */
type WsServerConfigInput = {
  port?: number | undefined;
  host?: string | undefined;
  heartbeatIntervalMs?: number | undefined;
  missedHeartbeatsBeforeDead?: number | undefined;
  authTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
  replayBufferSize?: number | undefined;
  sendBufferSoftLimit?: number | undefined;
  sendBufferHardLimit?: number | undefined;
  drainTimeoutMs?: number | undefined;
  maxFrameSizeBytes?: number | undefined;
  rateLimitWindowMs?: number | undefined;
  rateLimitMaxMessages?: number | null | undefined;
};

/** Zod schema that parses WebSocket server configuration and applies defaults. */
export const WsServerConfigSchema: z.ZodType<
  WsServerConfig,
  z.ZodTypeDef,
  WsServerConfigInput
> = z
  .object({
    port: z
      .number()
      .int()
      .nonnegative()
      .default(8393)
      .describe("Port to listen on (0 for random)"),
    host: z.string().default("127.0.0.1").describe("Host to bind to"),
    heartbeatIntervalMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe("Interval between heartbeat frames in milliseconds"),
    missedHeartbeatsBeforeDead: z
      .number()
      .int()
      .positive()
      .default(3)
      .describe(
        "Consecutive missed heartbeats before connection is considered dead",
      ),
    authTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(5_000)
      .describe("Time allowed for auth handshake after connect"),
    requestTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe("Time allowed for an individual request handler to finish"),
    replayBufferSize: z
      .number()
      .int()
      .positive()
      .default(1_000)
      .describe("Max events buffered per connection for reconnection replay"),
    sendBufferSoftLimit: z
      .number()
      .int()
      .positive()
      .default(64)
      .describe("Send buffer depth that triggers backpressure warning"),
    sendBufferHardLimit: z
      .number()
      .int()
      .positive()
      .default(256)
      .describe("Send buffer depth that triggers forced disconnect"),
    drainTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(5_000)
      .describe(
        "Time to wait for in-flight responses during graceful shutdown",
      ),
    maxFrameSizeBytes: z
      .number()
      .int()
      .positive()
      .default(1_048_576)
      .describe("Maximum accepted frame size (1 MiB default)"),
    rateLimitWindowMs: z
      .number()
      .int()
      .positive()
      .default(1_000)
      .describe("Rate limit window in milliseconds"),
    rateLimitMaxMessages: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(null)
      .describe(
        "Max messages per window per connection. null = unlimited (default)",
      ),
  })
  .refine((c) => c.sendBufferSoftLimit < c.sendBufferHardLimit, {
    message: "sendBufferSoftLimit must be less than sendBufferHardLimit",
  })
  .describe("WebSocket server configuration");
