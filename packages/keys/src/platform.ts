import type { TrustTier } from "@xmtp-broker/schemas";
import type { PlatformCapability } from "./config.js";

/**
 * Detect the current platform's key storage capability.
 * v0: always returns "software-vault" since the Swift CLI bridge is not yet implemented.
 */
export function detectPlatform(): PlatformCapability {
  // v0: software fallback only.
  // Future: check for Secure Enclave via broker-signer subprocess.
  return "software-vault";
}

/** Map platform capability to the corresponding trust tier. */
export function platformToTrustTier(platform: PlatformCapability): TrustTier {
  switch (platform) {
    case "secure-enclave":
    case "keychain-software":
    case "tpm":
      return "source-verified";
    case "software-vault":
      return "unverified";
  }
}
