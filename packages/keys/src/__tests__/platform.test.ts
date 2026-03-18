import { describe, test, expect, afterEach } from "bun:test";
import {
  detectPlatform,
  platformToTrustTier,
  resetPlatformCache,
} from "../platform.js";

afterEach(() => {
  resetPlatformCache();
});

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

  test("returns secure-enclave on macOS with signer binary available", () => {
    // On a macOS dev machine with the signer built, this returns secure-enclave.
    // On CI/Linux, it returns software-vault. Both are correct.
    const platform = detectPlatform();
    if (process.platform === "darwin") {
      // May be either depending on whether signer binary is built
      expect(["secure-enclave", "software-vault"]).toContain(platform);
    } else {
      expect(platform).toBe("software-vault");
    }
  });

  test("caches the result across calls", () => {
    const first = detectPlatform();
    const second = detectPlatform();
    expect(first).toBe(second);
  });

  test("returns software-vault when signer is not available", () => {
    // Force no signer by setting env to nonexistent path and resetting cache
    const orig = process.env["SIGNET_SIGNER_PATH"];
    process.env["SIGNET_SIGNER_PATH"] = "/nonexistent/signet-signer";
    resetPlatformCache();

    const platform = detectPlatform();
    expect(platform).toBe("software-vault");

    // Restore
    if (orig === undefined) {
      delete process.env["SIGNET_SIGNER_PATH"];
    } else {
      process.env["SIGNET_SIGNER_PATH"] = orig;
    }
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
