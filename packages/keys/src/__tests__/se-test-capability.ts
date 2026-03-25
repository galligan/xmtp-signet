import { findSignerBinary } from "../se-bridge.js";

type SecureEnclaveTestCapability =
  | { kind: "unsupported" }
  | { kind: "available"; signerPath: string }
  | { kind: "blocked"; signerPath: string; reason: string };

function decode(bytes: Uint8Array<ArrayBufferLike>): string {
  return new TextDecoder().decode(bytes).trim();
}

function probeSecureEnclaveForTests(): SecureEnclaveTestCapability {
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
 * True when this environment advertises Secure Enclave support but blocks real
 * key creation, which would make integration tests fail for operational reasons.
 */
export const shouldSkipBlockedSECreate =
  secureEnclaveTestCapability.kind === "blocked";
