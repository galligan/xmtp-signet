import { z } from "zod";

/** XMTP network environment that the core should connect to. */
export const XmtpEnvSchema: z.ZodEnum<["local", "dev", "production"]> = z
  .enum(["local", "dev", "production"])
  .describe("XMTP network environment");

/** XMTP network environment label. */
export type XmtpEnv = z.infer<typeof XmtpEnvSchema>;

/** Whether each group gets its own identity or shares one. */
export const IdentityModeSchema: z.ZodEnum<["per-group", "shared"]> = z
  .enum(["per-group", "shared"])
  .describe("Whether each group gets a unique identity or shares one");

/** Identity isolation strategy used by the core. */
export type IdentityMode = z.infer<typeof IdentityModeSchema>;

/** Parsed signet core configuration (all defaults applied). */
export type SignetCoreConfig = {
  dataDir: string;
  env: XmtpEnv;
  identityMode: IdentityMode;
  heartbeatIntervalMs: number;
  syncTimeoutMs: number;
  appVersion: string;
};

/** Input to SignetCoreConfigSchema (fields with defaults are optional). */
type SignetCoreConfigInput = {
  dataDir: string;
  env?: XmtpEnv | undefined;
  identityMode?: IdentityMode | undefined;
  heartbeatIntervalMs?: number | undefined;
  syncTimeoutMs?: number | undefined;
  appVersion?: string | undefined;
};

/** Zod schema for parsed signet core configuration. */
export const SignetCoreConfigSchema: z.ZodType<
  SignetCoreConfig,
  z.ZodTypeDef,
  SignetCoreConfigInput
> = z
  .object({
    dataDir: z.string().describe("Base directory for all signet data"),
    env: XmtpEnvSchema.default("dev").describe("XMTP network environment"),
    identityMode: IdentityModeSchema.default("per-group").describe(
      "Identity isolation strategy",
    ),
    heartbeatIntervalMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe("Heartbeat emission interval in milliseconds"),
    syncTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe("Maximum time to wait for initial sync"),
    appVersion: z
      .string()
      .default("xmtp-signet/0.1.0")
      .describe("App version string sent to XMTP network"),
  })
  .describe("Signet core configuration");
