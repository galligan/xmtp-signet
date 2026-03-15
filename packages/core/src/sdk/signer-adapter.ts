import { toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Configuration for creating an XMTP SDK signer.
 */
export interface XmtpSignerConfig {
  /** Hex-encoded secp256k1 private key (0x-prefixed). */
  readonly privateKey: `0x${string}`;
}

/**
 * Shape of the SDK's Identifier type (structural, no SDK import).
 *
 * Matches `@xmtp/node-bindings` Identifier with string-based
 * identifierKind that gets mapped to the const enum at the SDK boundary.
 */
export interface SdkIdentifier {
  readonly identifier: string;
  readonly identifierKind: "Ethereum" | "Passkey";
}

/**
 * Shape of the SDK's EOA Signer (structural, no SDK import).
 *
 * Matches @xmtp/node-sdk v6 Signer type for EOA:
 * - getIdentifier returns sync or async Identifier
 * - signMessage returns sync or async Uint8Array
 */
export interface SdkEoaSigner {
  readonly type: "EOA";
  getIdentifier(): SdkIdentifier | Promise<SdkIdentifier>;
  signMessage(message: string): Promise<Uint8Array> | Uint8Array;
}

/**
 * Create an XMTP SDK Signer from a secp256k1 private key.
 *
 * The signer is called once during `Client.create()` registration:
 * - `getIdentifier()` returns the lowercased Ethereum address (sync)
 * - `signMessage(text)` produces an EIP-191 ECDSA signature (65 bytes)
 *
 * After registration, use `Client.build()` — no signer needed.
 */
export function createXmtpSigner(config: XmtpSignerConfig): SdkEoaSigner {
  const account = privateKeyToAccount(config.privateKey);

  return {
    type: "EOA" as const,

    getIdentifier(): SdkIdentifier {
      return {
        identifier: account.address.toLowerCase(),
        identifierKind: "Ethereum",
      };
    },

    async signMessage(message: string): Promise<Uint8Array> {
      const sig = await account.signMessage({ message });
      return toBytes(sig);
    },
  };
}
