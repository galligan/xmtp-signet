import { describe, test, expect } from "bun:test";
import {
  KeyManagerConfigSchema,
  KeyPolicySchema,
  PlatformCapabilitySchema,
} from "../config.js";

describe("KeyPolicySchema", () => {
  test("accepts valid policies", () => {
    expect(KeyPolicySchema.parse("biometric")).toBe("biometric");
    expect(KeyPolicySchema.parse("passcode")).toBe("passcode");
    expect(KeyPolicySchema.parse("open")).toBe("open");
  });

  test("rejects invalid policy", () => {
    const result = KeyPolicySchema.safeParse("invalid");
    expect(result.success).toBe(false);
  });
});

describe("PlatformCapabilitySchema", () => {
  test("accepts valid capabilities", () => {
    expect(PlatformCapabilitySchema.parse("secure-enclave")).toBe(
      "secure-enclave",
    );
    expect(PlatformCapabilitySchema.parse("keychain-software")).toBe(
      "keychain-software",
    );
    expect(PlatformCapabilitySchema.parse("tpm")).toBe("tpm");
    expect(PlatformCapabilitySchema.parse("software-vault")).toBe(
      "software-vault",
    );
  });

  test("rejects invalid capability", () => {
    const result = PlatformCapabilitySchema.safeParse("magic");
    expect(result.success).toBe(false);
  });
});

describe("KeyManagerConfigSchema", () => {
  test("parses valid config with defaults", () => {
    const config = KeyManagerConfigSchema.parse({ dataDir: "/tmp/keys" });
    expect(config.dataDir).toBe("/tmp/keys");
    expect(config.rootKeyPolicy).toBe("biometric");
    expect(config.operationalKeyPolicy).toBe("open");
    expect(config.vaultKeyPolicy).toBe("open");
    expect(config.biometricGating.rootKeyCreation).toBe(false);
    expect(config.rotationIntervalSeconds).toBe(86400);
  });

  test("accepts overridden values", () => {
    const config = KeyManagerConfigSchema.parse({
      dataDir: "/tmp/keys",
      rootKeyPolicy: "open",
      operationalKeyPolicy: "passcode",
      vaultKeyPolicy: "biometric",
      biometricGating: { operationalKeyRotation: true },
      rotationIntervalSeconds: 7200,
    });
    expect(config.rootKeyPolicy).toBe("open");
    expect(config.operationalKeyPolicy).toBe("passcode");
    expect(config.vaultKeyPolicy).toBe("biometric");
    expect(config.biometricGating.operationalKeyRotation).toBe(true);
    expect(config.rotationIntervalSeconds).toBe(7200);
  });

  test("rejects missing dataDir", () => {
    const result = KeyManagerConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test("rejects negative rotationIntervalSeconds", () => {
    const result = KeyManagerConfigSchema.safeParse({
      dataDir: "/tmp",
      rotationIntervalSeconds: -1,
    });
    expect(result.success).toBe(false);
  });
});
