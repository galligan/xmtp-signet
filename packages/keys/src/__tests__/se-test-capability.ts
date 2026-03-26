import { findSignerBinary } from "../se-bridge.js";

/**
 * Secure Enclave test capability detection.
 *
 * SE tests are split into two tiers:
 *
 * 1. **se-bridge.test.ts** — deterministic, mock-based. Tests the bridge
 *    protocol (JSON parsing, error handling, exit codes) using mock signer
 *    scripts. Always runs on all platforms including CI.
 *
 * 2. **se-integration.test.ts** — live hardware tests. Requires macOS +
 *    Apple Silicon + compiled signet-signer + explicit opt-in via
 *    SIGNET_RUN_LIVE_SE_TESTS=1. Skipped everywhere else.
 *
 * This module gates tier 2 by probing the environment at import time.
 */
type SecureEnclaveTestCapability =
  | { kind: "disabled"; reason: string }
  | { kind: "unsupported" }
  | { kind: "available"; signerPath: string }
  | { kind: "blocked"; signerPath: string; reason: string };

const LIVE_SE_TESTS_ENABLED = process.env["SIGNET_RUN_LIVE_SE_TESTS"] === "1";

function decode(bytes: Uint8Array<ArrayBufferLike>): string {
  return new TextDecoder().decode(bytes).trim();
}

function probeSecureEnclaveForTests(): SecureEnclaveTestCapability {
  if (!LIVE_SE_TESTS_ENABLED) {
    return {
      kind: "disabled",
      reason: "Set SIGNET_RUN_LIVE_SE_TESTS=1 to run live Secure Enclave tests",
    };
  }

  if (process.platform !== "darwin") {
    return { kind: "unsupported" };
  }

  const signerPath = findSignerBinary();
  if (!signerPath) {
    return { kind: "unsupported" };
  }

  const info = Bun.spawnSync(
    [signerPath, "info", "--system", "--format", "json"],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    },
  );
  if (info.exitCode !== 0) {
    return { kind: "unsupported" };
  }

  let available = false;
  try {
    const parsed = JSON.parse(decode(info.stdout)) as { available?: boolean };
    available = parsed.available === true;
  } catch {
    available = false;
  }
  if (!available) {
    return { kind: "unsupported" };
  }

  const label = `signet-test-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const create = Bun.spawnSync(
    [
      signerPath,
      "create",
      "--label",
      label,
      "--policy",
      "open",
      "--format",
      "json",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    },
  );

  const stdout = decode(create.stdout);
  const stderr = decode(create.stderr);
  const combined = `${stdout}\n${stderr}`;

  if (create.exitCode === 0) {
    try {
      const parsed = JSON.parse(stdout) as { keyRef?: string };
      if (parsed.keyRef) {
        Bun.spawnSync(
          [
            signerPath,
            "delete",
            "--key-ref",
            parsed.keyRef,
            "--format",
            "json",
          ],
          {
            stdout: "pipe",
            stderr: "pipe",
            timeout: 5_000,
          },
        );
      }
    } catch {
      // Best-effort cleanup; the probe only determines test availability.
    }
    return { kind: "available", signerPath };
  }

  if (
    combined.includes("-25308") ||
    combined.includes("User interaction is not allowed")
  ) {
    return {
      kind: "blocked",
      signerPath,
      reason: "Secure Enclave key creation is blocked in this session",
    };
  }

  throw new Error(
    `Unexpected Secure Enclave probe failure (exit ${String(create.exitCode)}): ${combined}`,
  );
}

/** Secure Enclave test capability for the current execution context. */
export const secureEnclaveTestCapability = probeSecureEnclaveForTests();

/**
 * True when live Secure Enclave key creation should be skipped for operational
 * reasons or because the test run did not opt into hardware-backed coverage.
 */
export const shouldSkipBlockedSECreate =
  secureEnclaveTestCapability.kind === "blocked" ||
  secureEnclaveTestCapability.kind === "disabled";
