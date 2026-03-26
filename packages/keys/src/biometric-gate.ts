import { z } from "zod";
import { Result } from "better-result";
import { CancelledError, InternalError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";

/** Parsed biometric gate configuration. */
export type BiometricGateConfig = {
  rootKeyCreation: boolean;
  operationalKeyRotation: boolean;
  scopeExpansion: boolean;
  egressExpansion: boolean;
  agentCreation: boolean;
};

/** Input type with all fields optional for configuration merging. */
export type BiometricGateConfigInput = {
  rootKeyCreation?: boolean | undefined;
  operationalKeyRotation?: boolean | undefined;
  scopeExpansion?: boolean | undefined;
  egressExpansion?: boolean | undefined;
  agentCreation?: boolean | undefined;
};

/** Per-operation toggles for biometric gating. */
export const BiometricGateConfigSchema: z.ZodType<
  BiometricGateConfig,
  z.ZodTypeDef,
  BiometricGateConfigInput
> = z
  .object({
    rootKeyCreation: z
      .boolean()
      .default(false)
      .describe("Require biometric for root key creation"),
    operationalKeyRotation: z
      .boolean()
      .default(false)
      .describe("Require biometric for operational key rotation"),
    scopeExpansion: z
      .boolean()
      .default(false)
      .describe("Require biometric for expanding credential scope"),
    egressExpansion: z
      .boolean()
      .default(false)
      .describe("Require biometric for expanding egress permissions"),
    agentCreation: z
      .boolean()
      .default(false)
      .describe("Require biometric for creating new agent inboxes"),
  })
  .describe("Per-operation biometric gating configuration");

/** Operations that can be gated by biometric authentication. */
export type GatedOperation =
  | "rootKeyCreation"
  | "operationalKeyRotation"
  | "scopeExpansion"
  | "egressExpansion"
  | "agentCreation";

/** Callback to prompt biometric authentication. Returns Ok if confirmed. */
export type BiometricPrompter = (
  operation: GatedOperation,
) => Promise<Result<void, SignetError>>;

/**
 * Create a biometric gate that checks config before prompting.
 *
 * Returns a function that gates an operation: if the operation is enabled
 * in config, it calls the prompter. If disabled, it passes through.
 */
export function createBiometricGate(
  config: BiometricGateConfig,
  prompter: BiometricPrompter,
): (operation: GatedOperation) => Promise<Result<void, SignetError>> {
  return async (
    operation: GatedOperation,
  ): Promise<Result<void, SignetError>> => {
    if (!config[operation]) {
      return Result.ok(undefined);
    }

    try {
      return await prompter(operation);
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes("cancel")) {
        return Result.err(
          CancelledError.create(
            `Biometric authentication cancelled for ${operation}`,
          ),
        );
      }
      return Result.err(
        InternalError.create(
          `Biometric authentication failed for ${operation}`,
          { cause: String(cause) },
        ),
      );
    }
  };
}
