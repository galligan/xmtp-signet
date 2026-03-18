import { z } from "zod";

// -- Admin server config --

/** Configuration for the admin Unix socket server. */
export type AdminServerConfig = {
  socketPath?: string | undefined;
  authMode: "admin-key";
};

type AdminServerConfigInput =
  | {
      socketPath?: string | undefined;
      authMode?: "admin-key" | undefined;
    }
  | undefined;

/**
 * Configuration for the admin Unix socket server.
 */
export const AdminServerConfigSchema: z.ZodType<
  AdminServerConfig,
  z.ZodTypeDef,
  AdminServerConfigInput
> = z
  .object({
    socketPath: z.string().optional().describe("Unix socket path override"),
    authMode: z
      .literal("admin-key")
      .default("admin-key")
      .describe("Authentication mode for admin connections"),
  })
  .default({});

// -- HTTP server config --

/** Configuration for the HTTP API server. */
export type HttpServerConfig = {
  enabled: boolean;
  port: number;
  host: string;
};

type HttpServerConfigInput =
  | {
      enabled?: boolean | undefined;
      port?: number | undefined;
      host?: string | undefined;
    }
  | undefined;

export const HttpServerConfigSchema: z.ZodType<
  HttpServerConfig,
  z.ZodTypeDef,
  HttpServerConfigInput
> = z
  .object({
    enabled: z.boolean().default(false).describe("Enable the HTTP API server"),
    port: z
      .number()
      .int()
      .nonnegative()
      .default(8081)
      .describe("HTTP server port"),
    host: z.string().default("127.0.0.1").describe("HTTP server bind address"),
  })
  .default({});

// -- CLI config --

type SignetConfig = {
  env: "local" | "dev" | "production";
  identityMode: "per-group" | "shared";
  dataDir?: string | undefined;
};

type SignetConfigInput =
  | {
      env?: "local" | "dev" | "production" | undefined;
      identityMode?: "per-group" | "shared" | undefined;
      dataDir?: string | undefined;
    }
  | undefined;

/** Top-level CLI configuration. Parsed from TOML with env var overrides. */
export type CliConfig = {
  signet: SignetConfig;
  keys: {
    rootKeyPolicy: "biometric" | "passcode" | "open";
    operationalKeyPolicy: "biometric" | "passcode" | "open";
  };
  ws: {
    port: number;
    host: string;
  };
  http: HttpServerConfig;
  admin: AdminServerConfig;
  sessions: {
    defaultTtlSeconds: number;
    maxConcurrentPerAgent: number;
    heartbeatIntervalSeconds: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    auditLogPath?: string | undefined;
  };
};

type CliConfigInput = {
  signet?: SignetConfigInput;
  keys?:
    | {
        rootKeyPolicy?: "biometric" | "passcode" | "open" | undefined;
        operationalKeyPolicy?: "biometric" | "passcode" | "open" | undefined;
      }
    | undefined;
  ws?:
    | {
        port?: number | undefined;
        host?: string | undefined;
      }
    | undefined;
  http?: HttpServerConfigInput;
  admin?: AdminServerConfigInput;
  sessions?:
    | {
        defaultTtlSeconds?: number | undefined;
        maxConcurrentPerAgent?: number | undefined;
        heartbeatIntervalSeconds?: number | undefined;
      }
    | undefined;
  logging?:
    | {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        auditLogPath?: string | undefined;
      }
    | undefined;
};

const SignetConfigSchema: z.ZodType<
  SignetConfig,
  z.ZodTypeDef,
  SignetConfigInput
> = z
  .object({
    env: z
      .enum(["local", "dev", "production"])
      .default("dev")
      .describe("XMTP network environment"),
    identityMode: z
      .enum(["per-group", "shared"])
      .default("per-group")
      .describe("Identity isolation strategy"),
    dataDir: z.string().optional().describe("Data directory override"),
  })
  .default({});

const CliConfigBaseSchema = z
  .object({
    signet: SignetConfigSchema,
    keys: z
      .object({
        rootKeyPolicy: z
          .enum(["biometric", "passcode", "open"])
          .default("biometric")
          .describe("Protection level for the root key"),
        operationalKeyPolicy: z
          .enum(["biometric", "passcode", "open"])
          .default("open")
          .describe("Protection level for operational keys"),
      })
      .default({}),
    ws: z
      .object({
        port: z
          .number()
          .int()
          .nonnegative()
          .default(8393)
          .describe("WebSocket server port (0 for dynamic allocation)"),
        host: z
          .string()
          .default("127.0.0.1")
          .describe("WebSocket server bind address"),
      })
      .default({}),
    http: HttpServerConfigSchema,
    admin: AdminServerConfigSchema,
    sessions: z
      .object({
        defaultTtlSeconds: z
          .number()
          .int()
          .positive()
          .default(3600)
          .describe("Default session TTL in seconds"),
        maxConcurrentPerAgent: z
          .number()
          .int()
          .positive()
          .default(3)
          .describe("Maximum concurrent sessions per agent"),
        heartbeatIntervalSeconds: z
          .number()
          .int()
          .positive()
          .default(30)
          .describe("Heartbeat interval in seconds"),
      })
      .default({}),
    logging: z
      .object({
        level: z
          .enum(["debug", "info", "warn", "error"])
          .default("info")
          .describe("Log level"),
        auditLogPath: z
          .string()
          .optional()
          .describe("Audit log file path override"),
      })
      .default({}),
  })
  .strict();

/**
 * Top-level CLI configuration schema.
 * Parsed from TOML config file with env var overrides.
 */
export const CliConfigSchema: z.ZodType<
  CliConfig,
  z.ZodTypeDef,
  CliConfigInput
> = CliConfigBaseSchema;
