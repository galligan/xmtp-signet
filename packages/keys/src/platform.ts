import type { PlatformCapability } from "./config.js";
import { findSignerBinary } from "./se-bridge.js";

/** Trust tiers exposed by the key manager's platform detection. */
export type KeyTrustTier = "unverified" | "source-verified";

/** Cached platform detection result. */
let cachedPlatform: PlatformCapability | null = null;

/**
 * Detect the current platform's key storage capability.
 * On macOS with signet-signer binary available and SE reported as available,
 * returns "secure-enclave". Otherwise falls back to "software-vault".
 *
 * Result is cached — platform doesn't change during runtime.
 */
export function detectPlatform(): PlatformCapability {
  if (cachedPlatform !== null) return cachedPlatform;

  cachedPlatform = detectPlatformUncached();
  return cachedPlatform;
}

function detectPlatformUncached(): PlatformCapability {
  if (process.platform !== "darwin") return "software-vault";

  const signerPath = findSignerBinary();
  if (!signerPath) return "software-vault";

  // Synchronous check with 5-second timeout to avoid hanging on broken signer
  try {
    const result = Bun.spawnSync(
      [signerPath, "info", "--system", "--format", "json"],
      { stdout: "pipe", stderr: "pipe", timeout: 5_000 },
    );

    if (result.exitCode !== 0) return "software-vault";

    const stdout = new TextDecoder().decode(result.stdout);
    const parsed = JSON.parse(stdout) as { available?: boolean };

    if (parsed.available === true) return "secure-enclave";
  } catch {
    // Any failure falls through to software-vault
  }

  return "software-vault";
}

/** Reset cached platform (for testing). */
export function resetPlatformCache(): void {
  cachedPlatform = null;
}

/** Map platform capability to the corresponding trust tier. */
export function platformToTrustTier(
  platform: PlatformCapability,
): KeyTrustTier {
  switch (platform) {
    case "secure-enclave":
    case "keychain-software":
    case "tpm":
      return "source-verified";
    case "software-vault":
      return "unverified";
  }
}
