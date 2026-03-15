import type { CoreState } from "@xmtp-broker/contracts";
import { z } from "zod";

/** Daemon status as returned by `broker status` and admin `ping()`. */
export type DaemonStatus = {
  state: "running" | "draining" | "stopped";
  coreState: CoreState;
  pid: number;
  uptime: number;
  activeSessions: number;
  activeConnections: number;
  xmtpEnv: "local" | "dev" | "production";
  identityMode: "per-group" | "shared";
  wsPort: number;
  version: string;
};

/**
 * Daemon status response schema.
 * Returned by the `broker status` command and admin `ping()`.
 */
export const DaemonStatusSchema: z.ZodType<DaemonStatus> = z
  .object({
    state: z
      .enum(["running", "draining", "stopped"])
      .describe("Current daemon state"),
    coreState: z
      .enum([
        "uninitialized",
        "initializing",
        "ready-local",
        "ready",
        "shutting-down",
        "stopped",
        "error",
      ])
      .describe("Current broker core state"),
    pid: z.number().int().positive().describe("Daemon process ID"),
    uptime: z.number().nonnegative().describe("Uptime in seconds"),
    activeSessions: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of active sessions"),
    activeConnections: z
      .number()
      .int()
      .nonnegative()
      .describe("Number of active WebSocket connections"),
    xmtpEnv: z
      .enum(["local", "dev", "production"])
      .describe("XMTP network environment"),
    identityMode: z
      .enum(["per-group", "shared"])
      .describe("Identity isolation strategy"),
    wsPort: z.number().int().positive().describe("WebSocket server port"),
    version: z.string().describe("Broker version string"),
  })
  .describe("Daemon status response");
