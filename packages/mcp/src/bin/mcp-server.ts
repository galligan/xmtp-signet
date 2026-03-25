#!/usr/bin/env bun

/**
 * Standalone MCP server entry point.
 * Reads XMTP_SIGNET_CREDENTIAL_TOKEN from env, creates server,
 * starts stdio transport.
 */

import { createMcpServer } from "../server.js";
import { createActionRegistry } from "@xmtp/signet-contracts";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";

const credentialToken = process.env["XMTP_SIGNET_CREDENTIAL_TOKEN"];
if (!credentialToken) {
  console.error("XMTP_SIGNET_CREDENTIAL_TOKEN is required");
  process.exit(1);
}

// In a real deployment, these deps would come from the signet runtime.
// This entry point is a minimal wiring layer.
const registry = createActionRegistry();

const server = createMcpServer(
  {
    mode: "stdio",
    credentialToken,
  },
  {
    registry,
    signetId: process.env["XMTP_SIGNET_ID"] ?? "signet_default",
    signerProvider: {
      // Placeholder -- real signer injected by daemon
      async sign() {
        throw new Error("SignerProvider not configured");
      },
      async getPublicKey() {
        throw new Error("SignerProvider not configured");
      },
      async getFingerprint() {
        throw new Error("SignerProvider not configured");
      },
      async getDbEncryptionKey() {
        throw new Error("SignerProvider not configured");
      },
      async getXmtpIdentityKey() {
        throw new Error("SignerProvider not configured");
      },
    },
    tokenLookup: async () => {
      return Result.err(
        InternalError.create("Credential manager not configured"),
      );
    },
    credentialLookup: async () => {
      return Result.err(
        InternalError.create("Credential manager not configured"),
      );
    },
  },
);

const result = await server.start();
if (!result.isOk()) {
  console.error("Failed to start MCP server:", result.error.message);
  process.exit(1);
}

// Handle shutdown signals
process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
