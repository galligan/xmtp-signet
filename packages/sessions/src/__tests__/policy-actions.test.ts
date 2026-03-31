import { Result } from "better-result";
import { describe, expect, test, beforeEach } from "bun:test";
import type { HandlerContext } from "@xmtp/signet-contracts";
import type { PolicyManager } from "@xmtp/signet-contracts";
import { createPolicyManager } from "../policy-manager.js";
import { createPolicyActions } from "../policy-actions.js";
import type { PolicyConfigType } from "@xmtp/signet-schemas";

function stubCtx(): HandlerContext {
  return { requestId: "test-req-1", signal: AbortSignal.timeout(5_000) };
}

function makeConfig(
  overrides: Partial<PolicyConfigType> = {},
): PolicyConfigType {
  return {
    label: "Test Policy",
    allow: ["send", "reply"],
    deny: [],
    ...overrides,
  };
}

/** Helper: find an action by id and invoke its handler. */
function findAction(
  actions: ReturnType<typeof createPolicyActions>,
  id: string,
) {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new Error(`Action ${id} not found`);
  return action;
}

let manager: PolicyManager;
let actions: ReturnType<typeof createPolicyActions>;

beforeEach(() => {
  manager = createPolicyManager();
  actions = createPolicyActions({ policyManager: manager });
});

describe("createPolicyActions", () => {
  test("returns 5 action specs", () => {
    expect(actions).toHaveLength(5);
  });

  test("action IDs follow the policy.* convention", () => {
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual([
      "policy.create",
      "policy.list",
      "policy.info",
      "policy.update",
      "policy.remove",
    ]);
  });

  test("all actions declare http surface with admin auth", () => {
    for (const action of actions) {
      expect(action.http).toEqual({ auth: "admin" });
    }
  });

  test("intent and idempotent metadata are correct", () => {
    const create = findAction(actions, "policy.create");
    expect(create.intent).toBe("write");
    expect(create.idempotent).toBeUndefined();

    const list = findAction(actions, "policy.list");
    expect(list.intent).toBe("read");
    expect(list.idempotent).toBe(true);

    const info = findAction(actions, "policy.info");
    expect(info.intent).toBe("read");
    expect(info.idempotent).toBe(true);

    const update = findAction(actions, "policy.update");
    expect(update.intent).toBe("write");
    expect(update.idempotent).toBeUndefined();

    const remove = findAction(actions, "policy.remove");
    expect(remove.intent).toBe("destroy");
    expect(remove.idempotent).toBeUndefined();
  });

  describe("policy.create", () => {
    test("creates policy and returns record with policy_ ID", async () => {
      const action = findAction(actions, "policy.create");
      const result = await action.handler(makeConfig(), stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toHaveProperty("id");
      expect((result.value as { id: string }).id).toMatch(
        /^policy_[0-9a-f]{16}$/,
      );
    });
  });

  describe("policy.list", () => {
    test("returns empty array when no policies exist", async () => {
      const action = findAction(actions, "policy.list");
      const result = await action.handler({}, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toEqual([]);
    });

    test("returns active policies and excludes removed", async () => {
      const createAction = findAction(actions, "policy.create");
      const r1 = await createAction.handler(
        makeConfig({ label: "Policy A" }),
        stubCtx(),
      );
      const r2 = await createAction.handler(
        makeConfig({ label: "Policy B" }),
        stubCtx(),
      );
      expect(Result.isOk(r1)).toBe(true);
      expect(Result.isOk(r2)).toBe(true);
      if (!Result.isOk(r1)) return;

      // Remove Policy A
      const removeAction = findAction(actions, "policy.remove");
      await removeAction.handler(
        { policyId: (r1.value as { id: string }).id },
        stubCtx(),
      );

      const listAction = findAction(actions, "policy.list");
      const listResult = await listAction.handler({}, stubCtx());
      expect(Result.isOk(listResult)).toBe(true);
      if (!Result.isOk(listResult)) return;
      expect(listResult.value).toHaveLength(1);
    });
  });

  describe("policy.info", () => {
    test("looks up policy by ID", async () => {
      const createAction = findAction(actions, "policy.create");
      const created = await createAction.handler(
        makeConfig({ label: "Found Me" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const infoAction = findAction(actions, "policy.info");
      const result = await infoAction.handler({ policyId: id }, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "Found Me",
      );
    });

    test("looks up policy by label", async () => {
      const createAction = findAction(actions, "policy.create");
      await createAction.handler(makeConfig({ label: "read-only" }), stubCtx());

      const infoAction = findAction(actions, "policy.info");
      const result = await infoAction.handler(
        { policyId: "read-only" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "read-only",
      );
    });

    test("returns error for unknown label", async () => {
      const infoAction = findAction(actions, "policy.info");
      const result = await infoAction.handler(
        { policyId: "nonexistent" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("rejects malformed policy_ ID", async () => {
      const infoAction = findAction(actions, "policy.info");
      const result = await infoAction.handler(
        { policyId: "policy_short" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("validation");
      }
    });

    test("rejects ambiguous label when multiple policies share it", async () => {
      const createAction = findAction(actions, "policy.create");
      await createAction.handler(
        makeConfig({ label: "duplicate-policy" }),
        stubCtx(),
      );
      await createAction.handler(
        makeConfig({ label: "duplicate-policy" }),
        stubCtx(),
      );

      const infoAction = findAction(actions, "policy.info");
      const result = await infoAction.handler(
        { policyId: "duplicate-policy" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("validation");
      }
    });
  });

  describe("policy.update", () => {
    test("updates config fields", async () => {
      const createAction = findAction(actions, "policy.create");
      const created = await createAction.handler(
        makeConfig({ label: "Old" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const updateAction = findAction(actions, "policy.update");
      const result = await updateAction.handler(
        { policyId: id, changes: { label: "New" } },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "New",
      );
    });

    test("supports label resolution for update", async () => {
      const createAction = findAction(actions, "policy.create");
      await createAction.handler(
        makeConfig({ label: "updatable-policy" }),
        stubCtx(),
      );

      const updateAction = findAction(actions, "policy.update");
      const result = await updateAction.handler(
        {
          policyId: "updatable-policy",
          changes: { deny: ["send"] },
        },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(
        (result.value as { config: { deny: string[] } }).config.deny,
      ).toEqual(["send"]);
    });
  });

  describe("policy.remove", () => {
    test("removes policy, subsequent lookup fails", async () => {
      const createAction = findAction(actions, "policy.create");
      const created = await createAction.handler(
        makeConfig({ label: "Doomed" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const removeAction = findAction(actions, "policy.remove");
      const removeResult = await removeAction.handler(
        { policyId: id },
        stubCtx(),
      );
      expect(Result.isOk(removeResult)).toBe(true);
      if (!Result.isOk(removeResult)) return;
      expect(removeResult.value).toEqual({ removed: true });

      // List should exclude the removed policy
      const listAction = findAction(actions, "policy.list");
      const listResult = await listAction.handler({}, stubCtx());
      expect(Result.isOk(listResult)).toBe(true);
      if (!Result.isOk(listResult)) return;
      expect(listResult.value).toHaveLength(0);
    });

    test("supports label resolution for remove", async () => {
      const createAction = findAction(actions, "policy.create");
      await createAction.handler(
        makeConfig({ label: "removable-policy" }),
        stubCtx(),
      );

      const removeAction = findAction(actions, "policy.remove");
      const result = await removeAction.handler(
        { policyId: "removable-policy" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
    });
  });
});
