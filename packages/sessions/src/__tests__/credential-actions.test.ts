import { beforeEach, describe, expect, test } from "bun:test";
import type { CredentialManager, SignerProvider } from "@xmtp/signet-contracts";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import { createCredentialManager } from "../credential-manager.js";
import { createCredentialService } from "../service.js";
import { createCredentialActions } from "../actions.js";
import type { CredentialActionDeps } from "../actions.js";
import type { InternalCredentialManager } from "../credential-manager.js";

let manager: InternalCredentialManager;
let credentialService: CredentialManager;
let deps: CredentialActionDeps;

function makeStubSignerProvider(): SignerProvider {
  const err = InternalError.create("unused in credential action tests");
  return {
    sign: async () => Result.err(err),
    getPublicKey: async () => Result.err(err),
    getFingerprint: async () => Result.err(err),
    getDbEncryptionKey: async () => Result.err(err),
    getXmtpIdentityKey: async () => Result.err(err),
  };
}

beforeEach(() => {
  manager = createCredentialManager({
    defaultTtlSeconds: 60,
    maxConcurrentPerOperator: 3,
    renewalWindowSeconds: 10,
    heartbeatGracePeriod: 3,
  });

  credentialService = createCredentialService({ manager });
  deps = {
    credentialManager: credentialService,
  };
});

describe("credential action surfaces", () => {
  test("credential lifecycle actions are CLI-only and not exposed over MCP", () => {
    const actions = createCredentialActions(deps);

    for (const id of [
      "credential.issue",
      "credential.list",
      "credential.lookup",
      "credential.revoke",
    ]) {
      const action = actions.find((candidate) => candidate.id === id);
      expect(action).toBeDefined();
      expect(action?.cli).toBeDefined();
      expect(action?.mcp).toBeUndefined();
    }
  });

  test("credential.issue stamps owner provenance for admin callers", async () => {
    const action = createCredentialActions(deps).find(
      (candidate) => candidate.id === "credential.issue",
    );
    expect(action).toBeDefined();
    if (action === undefined) return;

    const result = await action.handler(
      {
        operatorId: "op_test1234",
        chatIds: ["conv_test1234"],
        allow: ["send"],
        deny: [],
      },
      {
        signetId: "signet",
        signerProvider: makeStubSignerProvider(),
        requestId: "req-1",
        signal: AbortSignal.timeout(1000),
        adminAuth: { adminKeyFingerprint: "fp-admin" },
      },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value.credential.issuedBy).toBe("owner");
  });
});
