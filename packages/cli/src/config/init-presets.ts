import { Result } from "better-result";
import { z } from "zod";
import { ValidationError } from "@xmtp/signet-schemas";
import { CliConfigSchema } from "./schema.js";
import type { CliConfig } from "./schema.js";

/** Named first-run postures supported by `xs init`. */
export const InitPresetSchema: z.ZodEnum<
  ["recommended", "trusted-local", "hardened"]
> = z.enum(["recommended", "trusted-local", "hardened"]);

/** Supported initialization posture label. */
export type InitPreset = z.infer<typeof InitPresetSchema>;

/**
 * Parse the optional `xs init` preset argument.
 *
 * Omitted input maps to the recommended posture.
 */
export function resolveInitPreset(
  input: string | undefined,
): Result<InitPreset, ValidationError> {
  if (input === undefined) {
    return Result.ok("recommended");
  }

  const parsed = InitPresetSchema.safeParse(input);
  if (!parsed.success) {
    return Result.err(
      ValidationError.create(
        "preset",
        "Expected one of: recommended, trusted-local, hardened",
        { received: input },
      ),
    );
  }

  return Result.ok(parsed.data);
}

/** Human-readable one-line summary used in CLI output and docs. */
export function describeInitPreset(preset: InitPreset): string {
  switch (preset) {
    case "recommended":
      return "Per-chat isolation with owner-gated sensitive reads.";
    case "trusted-local":
      return "Trusted local testing with shared identity mode and lower ceremony.";
    case "hardened":
      return "Per-chat isolation with stricter approval and shorter-lived defaults.";
  }
}

/**
 * Apply a named posture preset on top of an existing parsed CLI config.
 *
 * The preset only touches the fields that define the onboarding posture and
 * preserves environment, dataDir, ports, and other local overrides.
 */
export function applyInitPreset(
  baseConfig: CliConfig,
  preset: InitPreset,
): CliConfig {
  const config = structuredClone(baseConfig);

  switch (preset) {
    case "recommended":
      config.signet.identityMode = "per-group";
      config.keys.rootKeyPolicy = "biometric";
      config.keys.operationalKeyPolicy = "open";
      config.keys.vaultKeyPolicy = "open";
      config.biometricGating.rootKeyCreation = false;
      config.biometricGating.operationalKeyRotation = false;
      config.biometricGating.scopeExpansion = false;
      config.biometricGating.egressExpansion = false;
      config.biometricGating.agentCreation = false;
      config.biometricGating.adminReadElevation = true;
      config.credentials.defaultTtlSeconds = 3600;
      config.credentials.maxConcurrentPerOperator = 3;
      config.credentials.actionExpirySeconds = 300;
      return CliConfigSchema.parse(config);
    case "trusted-local":
      config.signet.identityMode = "shared";
      config.keys.rootKeyPolicy = "biometric";
      config.keys.operationalKeyPolicy = "open";
      config.keys.vaultKeyPolicy = "open";
      config.biometricGating.rootKeyCreation = false;
      config.biometricGating.operationalKeyRotation = false;
      config.biometricGating.scopeExpansion = false;
      config.biometricGating.egressExpansion = false;
      config.biometricGating.agentCreation = false;
      config.biometricGating.adminReadElevation = false;
      config.credentials.defaultTtlSeconds = 43_200;
      config.credentials.maxConcurrentPerOperator = 6;
      config.credentials.actionExpirySeconds = 1_800;
      return CliConfigSchema.parse(config);
    case "hardened":
      config.signet.identityMode = "per-group";
      config.keys.rootKeyPolicy = "biometric";
      config.keys.operationalKeyPolicy = "open";
      config.keys.vaultKeyPolicy = "passcode";
      config.biometricGating.rootKeyCreation = true;
      config.biometricGating.operationalKeyRotation = true;
      config.biometricGating.scopeExpansion = true;
      config.biometricGating.egressExpansion = true;
      config.biometricGating.agentCreation = true;
      config.biometricGating.adminReadElevation = true;
      config.credentials.defaultTtlSeconds = 900;
      config.credentials.maxConcurrentPerOperator = 1;
      config.credentials.actionExpirySeconds = 120;
      return CliConfigSchema.parse(config);
  }
}
