import { z } from "zod";
import {
  BiometricGateConfigSchema,
  type BiometricGateConfig,
  type BiometricGateConfigInput,
} from "./biometric-gate.js";

/** Access policy for a specific key tier. */
export const KeyPolicySchema: z.ZodEnum<["biometric", "passcode", "open"]> = z
  .enum(["biometric", "passcode", "open"])
  .describe("Access control policy for a key tier");

/** Key policy label. */
export type KeyPolicy = z.infer<typeof KeyPolicySchema>;

/** Hardware or storage capability detected for the current platform. */
export const PlatformCapabilitySchema: z.ZodEnum<
  ["secure-enclave", "keychain-software", "tpm", "software-vault"]
> = z
  .enum(["secure-enclave", "keychain-software", "tpm", "software-vault"])
  .describe("Actual hardware security capability detected");

/** Platform capability label. */
export type PlatformCapability = z.infer<typeof PlatformCapabilitySchema>;

/** Parsed key manager configuration (all defaults applied). */
export type KeyManagerConfig = {
  dataDir: string;
  rootKeyPolicy: KeyPolicy;
  operationalKeyPolicy: KeyPolicy;
  vaultKeyPolicy: KeyPolicy;
  biometricGating: BiometricGateConfig;
  /** Auto-rotation interval in seconds. 0 disables auto-rotation. */
  rotationIntervalSeconds: number;
};

/** Input to KeyManagerConfigSchema (fields with defaults are optional). */
type KeyManagerConfigInput = {
  dataDir: string;
  rootKeyPolicy?: KeyPolicy | undefined;
  operationalKeyPolicy?: KeyPolicy | undefined;
  vaultKeyPolicy?: KeyPolicy | undefined;
  biometricGating?: BiometricGateConfigInput | undefined;
  rotationIntervalSeconds?: number | undefined;
};

/** Zod schema for parsed key manager configuration. */
export const KeyManagerConfigSchema: z.ZodType<
  KeyManagerConfig,
  z.ZodTypeDef,
  KeyManagerConfigInput
> = z
  .object({
    dataDir: z.string().describe("Base directory for key storage"),
    rootKeyPolicy: KeyPolicySchema.default("biometric").describe(
      "Access policy for root key operations",
    ),
    operationalKeyPolicy: KeyPolicySchema.default("open").describe(
      "Access policy for routine operations",
    ),
    vaultKeyPolicy: KeyPolicySchema.default("open").describe(
      "Access policy for persisted vault secret protection",
    ),
    biometricGating: BiometricGateConfigSchema.default({}).describe(
      "Per-operation biometric gate configuration",
    ),
    rotationIntervalSeconds: z
      .number()
      .int()
      .nonnegative()
      .default(86400)
      .describe(
        "Auto-rotation interval for operational keys (seconds). 0 disables.",
      ),
  })
  .describe("Key manager configuration");
