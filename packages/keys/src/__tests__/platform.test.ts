import { describe, test, expect } from "bun:test";
import { detectPlatform, platformToTrustTier } from "../platform.js";

describe("detectPlatform", () => {
  test("returns a valid PlatformCapability", () => {
    const platform = detectPlatform();
    const valid: readonly string[] = [
      "secure-enclave",
      "keychain-software",
      "tpm",
      "software-vault",
    ];
    expect(valid).toContain(platform);
  });

  test("returns software-vault for v0", () => {
    // v0 always returns software-vault since no Swift bridge
    const platform = detectPlatform();
    expect(platform).toBe("software-vault");
  });
});

describe("platformToTrustTier", () => {
  test("maps secure-enclave to source-verified", () => {
    expect(platformToTrustTier("secure-enclave")).toBe("source-verified");
  });

  test("maps keychain-software to source-verified", () => {
    expect(platformToTrustTier("keychain-software")).toBe("source-verified");
  });

  test("maps tpm to source-verified", () => {
    expect(platformToTrustTier("tpm")).toBe("source-verified");
  });

  test("maps software-vault to unverified", () => {
    expect(platformToTrustTier("software-vault")).toBe("unverified");
  });
});
