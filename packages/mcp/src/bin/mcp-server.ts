#!/usr/bin/env bun

/**
 * Standalone MCP server entry point.
 * Reads XMTP_SIGNET_SESSION_TOKEN from env, creates server,
 * starts stdio transport.
 */

import { createMcpServer } from "../server.js";
import { createActionRegistry } from "@xmtp/signet-contracts";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";

const sessionToken = process.env["XMTP_SIGNET_SESSION_TOKEN"];
if (!sessionToken) {
  console.error("XMTP_SIGNET_SESSION_TOKEN is required");
  process.exit(1);
}

// In a real deployment, these deps would come from the signet runtime.
// This entry point is a minimal wiring layer.
const registry = createActionRegistry();

const server = createMcpServer(
  {
    mode: "stdio",
    sessionToken,
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
    sessionManager: {
      // Placeholder -- real session manager injected by daemon
      async issue() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async list() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async lookup() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async lookupByToken() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async revoke() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async heartbeat() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
      async isActive() {
        return Result.err(
          InternalError.create("SessionManager not configured"),
        );
      },
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
