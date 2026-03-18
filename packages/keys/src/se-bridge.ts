import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { KeyPolicy } from "./config.js";
import {
  SeCreateResponseSchema,
  SeSignResponseSchema,
  SeSystemInfoResponseSchema,
  type SeCreateResponse,
  type SeSignResponse,
  type SeSystemInfoResponse,
} from "./se-protocol.js";

/**
 * Timeout for subprocess operations (ms).
 * 30 seconds to accommodate Touch ID / passcode prompts on biometric-policy keys.
 * Override via SIGNET_SIGNER_TIMEOUT_MS env var.
 */
const SUBPROCESS_TIMEOUT_MS = parseInt(
  process.env["SIGNET_SIGNER_TIMEOUT_MS"] ?? "30000",
  10,
);

/**
 * Find the signet-signer binary. Resolution order:
 * 1. SIGNET_SIGNER_PATH env var
 * 2. <repo-root>/signet-signer/.build/release/signet-signer
 * 3. signet-signer on $PATH
 */
export function findSignerBinary(): string | null {
  // 1. Explicit env override
  const envPath = process.env["SIGNET_SIGNER_PATH"];
  if (envPath && existsSync(envPath)) {
    return envPath;
  }

  // 2. Local dev build — walk up from this file to repo root
  const repoRoot = findRepoRoot();
  if (repoRoot) {
    const localPath = join(
      repoRoot,
      "signet-signer",
      ".build",
      "release",
      "signet-signer",
    );
    if (existsSync(localPath)) {
      return localPath;
    }
  }

  // 3. System PATH — check with `which`
  try {
    const result = Bun.spawnSync(["which", "signet-signer"]);
    if (result.exitCode === 0) {
      const path = new TextDecoder().decode(result.stdout).trim();
      if (path) return path;
    }
  } catch {
    // which not available or failed
  }

  return null;
}

/** Walk up from this module's directory to find the repo root (has package.json + signet-signer/). */
function findRepoRoot(): string | null {
  let dir = dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "signet-signer"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Run signet-signer with args and parse JSON stdout. */
async function runSigner<T>(
  signerPath: string,
  args: readonly string[],
  schema: {
    safeParse(
      data: unknown,
    ):
      | { success: true; data: T }
      | { success: false; error: { message: string } };
  },
): Promise<Result<T, InternalError>> {
  try {
    const proc = Bun.spawn([signerPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, SUBPROCESS_TIMEOUT_MS);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (timedOut) {
      return Result.err(
        InternalError.create("signet-signer timed out", {
          category: "timeout",
          timeoutMs: SUBPROCESS_TIMEOUT_MS,
        }),
      );
    }

    if (exitCode === 2) {
      return Result.err(
        InternalError.create("SE authentication cancelled by user", {
          category: "cancelled",
          exitCode,
          stderr: stderr.trim(),
        }),
      );
    }

    if (exitCode !== 0) {
      return Result.err(
        InternalError.create("signet-signer failed", {
          exitCode,
          stderr: stderr.trim(),
          args,
        }),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return Result.err(
        InternalError.create("signet-signer returned invalid JSON", {
          stdout: stdout.slice(0, 200),
        }),
      );
    }

    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      return Result.err(
        InternalError.create("signet-signer response validation failed", {
          cause: validated.error.message,
        }),
      );
    }

    return Result.ok(validated.data);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to spawn signet-signer", {
        cause: String(e),
      }),
    );
  }
}

/** Create a new P-256 key in the Secure Enclave. */
export async function seCreate(
  label: string,
  policy: KeyPolicy,
  signerPath: string,
): Promise<Result<SeCreateResponse, InternalError>> {
  return runSigner(
    signerPath,
    ["create", "--label", label, "--policy", policy, "--format", "json"],
    SeCreateResponseSchema,
  );
}

/** Sign data with a Secure Enclave key. */
export async function seSign(
  keyRef: string,
  data: Uint8Array,
  signerPath: string,
): Promise<Result<SeSignResponse, InternalError>> {
  const hex = Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return runSigner(
    signerPath,
    ["sign", "--key-ref", keyRef, "--data", hex, "--format", "json"],
    SeSignResponseSchema,
  );
}

/** Query Secure Enclave system availability. */
export async function seInfo(
  signerPath: string,
): Promise<Result<SeSystemInfoResponse, InternalError>> {
  return runSigner(
    signerPath,
    ["info", "--system", "--format", "json"],
    SeSystemInfoResponseSchema,
  );
}

/** Delete a Secure Enclave key (best-effort). */
export async function seDelete(
  keyRef: string,
  signerPath: string,
): Promise<Result<void, InternalError>> {
  try {
    const proc = Bun.spawn(
      [signerPath, "delete", "--key-ref", keyRef, "--format", "json"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const timeout = setTimeout(() => {
      proc.kill();
    }, SUBPROCESS_TIMEOUT_MS);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return Result.err(
        InternalError.create("signet-signer delete failed", {
          exitCode,
          stderr: stderr.trim(),
        }),
      );
    }

    return Result.ok(undefined);
  } catch (e) {
    return Result.err(
      InternalError.create("Failed to spawn signet-signer for delete", {
        cause: String(e),
      }),
    );
  }
}
