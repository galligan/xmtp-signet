import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import {
  createBiometricGate,
  BiometricGateConfigSchema,
  type BiometricGateConfig,
  type GatedOperation,
} from "../biometric-gate.js";

describe("BiometricGateConfig", () => {
  test("defaults: rootKeyCreation on, everything else off", () => {
    const config = BiometricGateConfigSchema.parse({});
    expect(config.rootKeyCreation).toBe(true);
    expect(config.operationalKeyRotation).toBe(false);
    expect(config.viewUpgrade).toBe(false);
    expect(config.grantEscalation).toBe(false);
    expect(config.agentCreation).toBe(false);
  });
});

describe("createBiometricGate", () => {
  const allOff: BiometricGateConfig = {
    rootKeyCreation: false,
    operationalKeyRotation: false,
    viewUpgrade: false,
    grantEscalation: false,
    agentCreation: false,
  };

  const allOn: BiometricGateConfig = {
    rootKeyCreation: true,
    operationalKeyRotation: true,
    viewUpgrade: true,
    grantEscalation: true,
    agentCreation: true,
  };

  test("passes through when operation is disabled", async () => {
    let prompted = false;
    const gate = createBiometricGate(allOff, async () => {
      prompted = true;
      return Result.ok(undefined);
    });

    const result = await gate("rootKeyCreation");
    expect(result.isOk()).toBe(true);
    expect(prompted).toBe(false);
  });

  test("prompts when operation is enabled", async () => {
    const prompted: GatedOperation[] = [];
    const gate = createBiometricGate(allOn, async (op) => {
      prompted.push(op);
      return Result.ok(undefined);
    });

    const result = await gate("operationalKeyRotation");
    expect(result.isOk()).toBe(true);
    expect(prompted).toEqual(["operationalKeyRotation"]);
  });

  test("returns error when prompter returns error", async () => {
    const gate = createBiometricGate(allOn, async () => {
      return Result.err({
        _tag: "CancelledError" as const,
        code: 1800,
        category: "cancelled" as const,
        message: "User cancelled",
        context: null,
      });
    });

    const result = await gate("viewUpgrade");
    expect(result.isErr()).toBe(true);
  });

  test("wraps thrown errors as InternalError", async () => {
    const gate = createBiometricGate(allOn, async () => {
      throw new Error("SE bridge timeout");
    });

    const result = await gate("agentCreation");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("internal");
    }
  });

  test("wraps cancel-like thrown errors as CancelledError", async () => {
    const gate = createBiometricGate(allOn, async () => {
      throw new Error("User pressed cancel");
    });

    const result = await gate("rootKeyCreation");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("cancelled");
    }
  });
});
