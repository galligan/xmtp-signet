import { afterEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import { createKeyManager } from "../key-manager-compat.js";
import { createWalletActions } from "../wallet-actions.js";

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
  const dataDir = await mkdtemp(join(tmpdir(), "xmtp-signet-wallet-actions-"));
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

describe("createWalletActions", () => {
  test("wallet.create creates a managed wallet", async () => {
    const keyManager = await createManager();
    const actions = createWalletActions({ keyManager });
    const create = findAction<
      { label: string },
      { id: string; label: string; accountCount: number }
    >(actions, "wallet.create");

    const result = await create.handler({ label: "main" });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("wallet.create failed");
    }

    expect(result.value.label).toBe("main");
    expect(result.value.accountCount).toBe(0);
  });

  test("wallet.list returns created wallets", async () => {
    const keyManager = await createManager();
    const actions = createWalletActions({ keyManager });
    const create = findAction<{ label: string }, { id: string }>(
      actions,
      "wallet.create",
    );
    const list = findAction<Record<string, never>, readonly { id: string }[]>(
      actions,
      "wallet.list",
    );

    await create.handler({ label: "main" });
    await create.handler({ label: "backup" });

    const result = await list.handler({});
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("wallet.list failed");
    }

    expect(result.value).toHaveLength(2);
  });

  test("wallet.info returns wallet details and derived accounts", async () => {
    const keyManager = await createManager();
    const createResult = await keyManager.createWallet("main");
    expect(Result.isOk(createResult)).toBe(true);
    if (Result.isError(createResult)) {
      throw new Error("create wallet failed");
    }

    const actions = createWalletActions({ keyManager });
    const info = findAction<
      { walletId: string },
      { id: string; accounts: readonly unknown[] }
    >(actions, "wallet.info");

    const result = await info.handler({ walletId: createResult.value.id });
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) {
      throw new Error("wallet.info failed");
    }

    expect(result.value.id).toBe(createResult.value.id);
    expect(Array.isArray(result.value.accounts)).toBe(true);
    expect(result.value.accounts).toHaveLength(0);
  });
});
