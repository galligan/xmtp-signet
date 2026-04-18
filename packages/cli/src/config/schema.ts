import { z } from "zod";
import { BiometricGateConfigSchema } from "@xmtp/signet-keys";
import {
  AgentAdaptersConfig,
  type AgentAdaptersConfigType,
} from "@xmtp/signet-schemas";
import type {
  BiometricGateConfig,
  BiometricGateConfigInput,
} from "@xmtp/signet-keys";

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

/** Schema for the optional HTTP API server configuration block. */
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

/** Supported onboarding scheme IDs for invite, profile, and first-run flows. */
export type OnboardingSchemeId = "convos";

type OnboardingConfig = {
  scheme: OnboardingSchemeId;
};

type OnboardingConfigInput =
  | {
      scheme?: OnboardingSchemeId | undefined;
    }
  | undefined;

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
  onboarding: OnboardingConfig;
  signet: SignetConfig;
  defaults: {
    profileName?: string | undefined;
  };
  keys: {
    rootKeyPolicy: "biometric" | "passcode" | "open";
    operationalKeyPolicy: "biometric" | "passcode" | "open";
    vaultKeyPolicy: "biometric" | "passcode" | "open";
  };
  biometricGating: BiometricGateConfig;
  ws: {
    port: number;
    host: string;
  };
  http: HttpServerConfig;
  admin: AdminServerConfig;
  credentials: {
    defaultTtlSeconds: number;
    maxConcurrentPerOperator: number;
    actionExpirySeconds: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    auditLogPath?: string | undefined;
  };
  agent: {
    adapters: AgentAdaptersConfigType;
  };
};

type CliConfigInput = {
  onboarding?: OnboardingConfigInput;
  signet?: SignetConfigInput;
  defaults?:
    | {
        profileName?: string | undefined;
      }
    | undefined;
  keys?:
    | {
        rootKeyPolicy?: "biometric" | "passcode" | "open" | undefined;
        operationalKeyPolicy?: "biometric" | "passcode" | "open" | undefined;
        vaultKeyPolicy?: "biometric" | "passcode" | "open" | undefined;
      }
    | undefined;
  biometricGating?: BiometricGateConfigInput | undefined;
  ws?:
    | {
        port?: number | undefined;
        host?: string | undefined;
      }
    | undefined;
  http?: HttpServerConfigInput;
  admin?: AdminServerConfigInput;
  credentials?:
    | {
        defaultTtlSeconds?: number | undefined;
        maxConcurrentPerOperator?: number | undefined;
        actionExpirySeconds?: number | undefined;
      }
    | undefined;
  logging?:
    | {
        level?: "debug" | "info" | "warn" | "error" | undefined;
        auditLogPath?: string | undefined;
      }
    | undefined;
  agent?:
    | {
        adapters?: AgentAdaptersConfigType | undefined;
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

const OnboardingConfigSchema: z.ZodType<
  OnboardingConfig,
  z.ZodTypeDef,
  OnboardingConfigInput
> = z
  .object({
    scheme: z
      .literal("convos")
      .default("convos")
      .describe("Onboarding scheme used for invite and profile flows"),
  })
  .default({});

const CliConfigBaseSchema = z
  .object({
    onboarding: OnboardingConfigSchema,
    signet: SignetConfigSchema,
    defaults: z
      .object({
        profileName: z
          .string()
          .optional()
          .describe("Default human-facing profile name for Convos flows"),
      })
      .default({}),
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
        vaultKeyPolicy: z
          .enum(["biometric", "passcode", "open"])
          .default("open")
          .describe("Protection level for persisted vault secret material"),
      })
      .default({}),
    biometricGating: BiometricGateConfigSchema.default({}),
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
    credentials: z
      .object({
        defaultTtlSeconds: z
          .number()
          .int()
          .positive()
          .default(3600)
          .describe("Default credential TTL in seconds"),
        maxConcurrentPerOperator: z
          .number()
          .int()
          .positive()
          .default(3)
          .describe("Maximum concurrent credentials per operator"),
        actionExpirySeconds: z
          .number()
          .int()
          .positive()
          .default(300)
          .describe("TTL for pending actions awaiting confirmation (seconds)"),
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
    agent: z
      .object({
        adapters: AgentAdaptersConfig.describe(
          "Adapter registry entries for built-in or adopted external adapters",
        ),
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
