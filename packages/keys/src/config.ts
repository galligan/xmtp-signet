import { z } from "zod";

export const KeyPolicySchema: z.ZodEnum<
  ["biometric", "passcode", "open"]
> = z
  .enum(["biometric", "passcode", "open"])
  .describe("Access control policy for a key tier");

export type KeyPolicy = z.infer<typeof KeyPolicySchema>;

export const PlatformCapabilitySchema: z.ZodEnum<
  ["secure-enclave", "keychain-software", "tpm", "software-vault"]
> = z
  .enum(["secure-enclave", "keychain-software", "tpm", "software-vault"])
  .describe("Actual hardware security capability detected");

export type PlatformCapability = z.infer<typeof PlatformCapabilitySchema>;

/** Parsed key manager configuration (all defaults applied). */
export type KeyManagerConfig = {
  dataDir: string;
  rootKeyPolicy: KeyPolicy;
  operationalKeyPolicy: KeyPolicy;
  sessionKeyTtlSeconds: number;
};

/** Input to KeyManagerConfigSchema (fields with defaults are optional). */
type KeyManagerConfigInput = {
  dataDir: string;
  rootKeyPolicy?: KeyPolicy | undefined;
  operationalKeyPolicy?: KeyPolicy | undefined;
  sessionKeyTtlSeconds?: number | undefined;
};

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
    sessionKeyTtlSeconds: z
      .number()
      .int()
      .positive()
      .default(3600)
      .describe("Default TTL for session keys"),
  })
  .describe("Key manager configuration");
