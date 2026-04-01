import { afterEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import { createOperatorManager } from "../../../sessions/src/operator-manager.js";
import { createKeyManager } from "../key-manager-compat.js";
import { createKeyActions } from "../key-actions.js";

const testDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    testDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function createManager() {
  const dataDir = await mkdtemp(join(tmpdir(), "xmtp-signet-key-actions-"));
  testDirs.push(dataDir);

  const managerResult = await createKeyManager({
    dataDir,
    rootKeyPolicy: "open",
    operationalKeyPolicy: "open",
    vaultKeyPolicy: "open",
  });
  expect(Result.isOk(managerResult)).toBe(true);
  if (Result.isError(managerResult)) {
    throw new Error("failed to create key manager");
  }

  const initResult = await managerResult.value.initialize();
  expect(Result.isOk(initResult)).toBe(true);

  return managerResult.value;
}

function findAction<TInput, TOutput>(
  actions: ActionSpec<unknown, unknown, SignetError>[],
  id: string,
): ActionSpec<TInput, TOutput, SignetError> {
  const action = actions.find((spec) => spec.id === id);
  expect(action).toBeDefined();
  return action as ActionSpec<TInput, TOutput, SignetError>;
}

describe("createKeyActions", () => {
  test("keys.init binds a wallet to the operator and provisions key material", async () => {
    const keyManager = await createManager();
    const operatorManager = createOperatorManager();
    const operator = await operatorManager.create({
      label: "alpha",
      role: "operator",
      scopeMode: "shared",
      provider: "internal",
    });
    expect(Result.isOk(operator)).toBe(true);
    if (Result.isError(operator)) {
      throw new Error("operator.create failed");
    }

    const actions = createKeyActions({ keyManager, operatorManager });
    const init = findAction<
      { operatorId: string; walletId?: string },
      {
        operatorId: string;
        walletId: string;
        createdWallet: boolean;
        createdOperationalKey: boolean;
        trustTier: string;
        identityKeyRef: string;
        operationalKey: { identityId: string; walletId?: string };
      }
    >(actions, "keys.init");

    const result = await init.handler({ operatorId: operator.value.id });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("keys.init failed");
    }

    expect(result.value.operatorId).toBe(operator.value.id);
    expect(result.value.walletId).toBeTruthy();
    expect(result.value.createdWallet).toBe(true);
    expect(result.value.createdOperationalKey).toBe(true);
    expect(result.value.trustTier).toBe(keyManager.trustTier);
    expect(result.value.identityKeyRef).toBe(
      `xmtp-identity-key:${operator.value.id}`,
    );
    expect(result.value.operationalKey.identityId).toBe(operator.value.id);
    expect(result.value.operationalKey.walletId).toBe(result.value.walletId);

    const updated = await operatorManager.lookup(operator.value.id);
    expect(Result.isOk(updated)).toBe(true);
    if (Result.isError(updated)) {
      throw new Error("operator lookup failed");
    }
    expect(updated.value.config.walletId).toBe(result.value.walletId);
  });

  test("keys.list returns provisioned operational keys with wallet metadata", async () => {
    const keyManager = await createManager();
    const operatorManager = createOperatorManager();
    const operator = await operatorManager.create({
      label: "alpha",
      role: "operator",
      scopeMode: "shared",
      provider: "internal",
    });
    expect(Result.isOk(operator)).toBe(true);
    if (Result.isError(operator)) {
      throw new Error("operator.create failed");
    }

    const actions = createKeyActions({ keyManager, operatorManager });
    const init = findAction<{ operatorId: string }, { walletId: string }>(
      actions,
      "keys.init",
    );
    const list = findAction<
      Record<string, never>,
      readonly { identityId: string; walletId?: string; trustTier: string }[]
    >(actions, "keys.list");

    const initialized = await init.handler({ operatorId: operator.value.id });
    expect(Result.isOk(initialized)).toBe(true);
    if (Result.isError(initialized)) {
      throw new Error("keys.init failed");
    }

    const result = await list.handler({});
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("keys.list failed");
    }

    expect(result.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          identityId: operator.value.id,
          walletId: initialized.value.walletId,
          trustTier: keyManager.trustTier,
        }),
      ]),
    );
  });

  test("keys.info resolves a key by key ID", async () => {
    const keyManager = await createManager();
    const operatorManager = createOperatorManager();
    const operator = await operatorManager.create({
      label: "alpha",
      role: "operator",
      scopeMode: "shared",
      provider: "internal",
    });
    expect(Result.isOk(operator)).toBe(true);
    if (Result.isError(operator)) {
      throw new Error("operator.create failed");
    }

    const actions = createKeyActions({ keyManager, operatorManager });
    const init = findAction<
      { operatorId: string },
      {
        walletId: string;
        operationalKey: { keyId: string; fingerprint: string };
      }
    >(actions, "keys.init");
    const info = findAction<
      { keyId: string },
      { keyId: string; fingerprint: string; walletId?: string }
    >(actions, "keys.info");

    const initialized = await init.handler({ operatorId: operator.value.id });
    expect(Result.isOk(initialized)).toBe(true);
    if (Result.isError(initialized)) {
      throw new Error("keys.init failed");
    }

    const result = await info.handler({
      keyId: initialized.value.operationalKey.keyId,
    });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("keys.info failed");
    }

    expect(result.value.keyId).toBe(initialized.value.operationalKey.keyId);
    expect(result.value.fingerprint).toBe(
      initialized.value.operationalKey.fingerprint,
    );
    expect(result.value.walletId).toBe(initialized.value.walletId);
  });
});
