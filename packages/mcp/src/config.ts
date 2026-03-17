import { z } from "zod";

/**
 * MCP server configuration schema.
 * Validated at server creation time.
 */
export const McpServerConfigSchema: z.ZodObject<{
  mode: z.ZodDefault<z.ZodEnum<["stdio", "embedded"]>>;
  serverName: z.ZodDefault<z.ZodString>;
  serverVersion: z.ZodDefault<z.ZodString>;
  toolPrefix: z.ZodDefault<z.ZodString>;
  sessionToken: z.ZodString;
  requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
}> = z.object({
  mode: z
    .enum(["stdio", "embedded"])
    .default("stdio")
    .describe("Transport mode: stdio for standalone, embedded for daemon"),
  serverName: z
    .string()
    .default("xmtp-signet")
    .describe("Server name advertised during MCP initialization"),
  serverVersion: z
    .string()
    .default("0.1.0")
    .describe("Server version advertised during MCP initialization"),
  toolPrefix: z
    .string()
    .default("signet")
    .describe("Prefix for all tool names (e.g., signet/message/send)"),
  sessionToken: z
    .string()
    .describe("Session bearer token for authenticating the MCP caller"),
  requestTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(30_000)
    .describe("Timeout for handler execution"),
});

/** Parsed MCP server configuration. */
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
