import { Result } from "better-result";
import { describe, expect, test, beforeEach } from "bun:test";
import type { HandlerContext } from "@xmtp/signet-contracts";
import type { OperatorManager } from "@xmtp/signet-contracts";
import { createOperatorManager } from "../operator-manager.js";
import { createOperatorActions } from "../operator-actions.js";
import type { OperatorConfigType } from "@xmtp/signet-schemas";

function stubCtx(): HandlerContext {
  return { requestId: "test-req-1", signal: AbortSignal.timeout(5_000) };
}

function makeConfig(
  overrides: Partial<OperatorConfigType> = {},
): OperatorConfigType {
  return {
    label: "Test Operator",
    role: "operator",
    scopeMode: "per-chat",
    ...overrides,
  };
}

/** Helper: find an action by id and invoke its handler. */
function findAction(
  actions: ReturnType<typeof createOperatorActions>,
  id: string,
) {
  const action = actions.find((a) => a.id === id);
  if (!action) throw new Error(`Action ${id} not found`);
  return action;
}

let manager: OperatorManager;
let actions: ReturnType<typeof createOperatorActions>;

beforeEach(() => {
  manager = createOperatorManager();
  actions = createOperatorActions({ operatorManager: manager });
});

describe("createOperatorActions", () => {
  test("returns 5 action specs", () => {
    expect(actions).toHaveLength(5);
  });

  test("action IDs follow the operator.* convention", () => {
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual([
      "operator.create",
      "operator.list",
      "operator.info",
      "operator.update",
      "operator.remove",
    ]);
  });

  test("all actions declare http surface with admin auth", () => {
    for (const action of actions) {
      expect(action.http).toEqual({ auth: "admin" });
    }
  });

  describe("operator.create", () => {
    test("creates operator and returns record with op_ ID", async () => {
      const action = findAction(actions, "operator.create");
      const result = await action.handler(makeConfig(), stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toHaveProperty("id");
      expect((result.value as { id: string }).id).toMatch(/^op_[0-9a-f]{16}$/);
    });

    test("has write intent", () => {
      const action = findAction(actions, "operator.create");
      expect(action.intent).toBe("write");
    });
  });

  describe("operator.list", () => {
    test("returns empty array when no operators exist", async () => {
      const action = findAction(actions, "operator.list");
      const result = await action.handler({}, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(result.value).toEqual([]);
    });

    test("returns active operators and excludes removed", async () => {
      const createAction = findAction(actions, "operator.create");
      const r1 = await createAction.handler(
        makeConfig({ label: "Op A" }),
        stubCtx(),
      );
      const r2 = await createAction.handler(
        makeConfig({ label: "Op B" }),
        stubCtx(),
      );
      expect(Result.isOk(r1)).toBe(true);
      expect(Result.isOk(r2)).toBe(true);
      if (!Result.isOk(r1)) return;

      // Remove Op A
      const removeAction = findAction(actions, "operator.remove");
      await removeAction.handler(
        { operatorId: (r1.value as { id: string }).id },
        stubCtx(),
      );

      const listAction = findAction(actions, "operator.list");
      const listResult = await listAction.handler({}, stubCtx());
      expect(Result.isOk(listResult)).toBe(true);
      if (!Result.isOk(listResult)) return;
      expect(listResult.value).toHaveLength(1);
    });

    test("has read intent and is idempotent", () => {
      const action = findAction(actions, "operator.list");
      expect(action.intent).toBe("read");
      expect(action.idempotent).toBe(true);
    });
  });

  describe("operator.info", () => {
    test("looks up operator by ID", async () => {
      const createAction = findAction(actions, "operator.create");
      const created = await createAction.handler(
        makeConfig({ label: "Found Me" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const infoAction = findAction(actions, "operator.info");
      const result = await infoAction.handler({ operatorId: id }, stubCtx());
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "Found Me",
      );
    });

    test("looks up operator by label", async () => {
      const createAction = findAction(actions, "operator.create");
      await createAction.handler(makeConfig({ label: "alice-bot" }), stubCtx());

      const infoAction = findAction(actions, "operator.info");
      const result = await infoAction.handler(
        { operatorId: "alice-bot" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "alice-bot",
      );
    });

    test("returns error for unknown label", async () => {
      const infoAction = findAction(actions, "operator.info");
      const result = await infoAction.handler(
        { operatorId: "nonexistent" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
    });

    test("rejects malformed op_ ID", async () => {
      const infoAction = findAction(actions, "operator.info");
      const result = await infoAction.handler(
        { operatorId: "op_short" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("validation");
      }
    });

    test("rejects ambiguous label when multiple operators share it", async () => {
      const createAction = findAction(actions, "operator.create");
      await createAction.handler(
        makeConfig({ label: "duplicate-bot" }),
        stubCtx(),
      );
      await createAction.handler(
        makeConfig({ label: "duplicate-bot" }),
        stubCtx(),
      );

      const infoAction = findAction(actions, "operator.info");
      const result = await infoAction.handler(
        { operatorId: "duplicate-bot" },
        stubCtx(),
      );
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error.category).toBe("validation");
      }
    });
  });

  describe("operator.update", () => {
    test("updates config fields", async () => {
      const createAction = findAction(actions, "operator.create");
      const created = await createAction.handler(
        makeConfig({ label: "Old" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const updateAction = findAction(actions, "operator.update");
      const result = await updateAction.handler(
        { operatorId: id, changes: { label: "New" } },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect((result.value as { config: { label: string } }).config.label).toBe(
        "New",
      );
    });

    test("supports label resolution for update", async () => {
      const createAction = findAction(actions, "operator.create");
      await createAction.handler(
        makeConfig({ label: "updatable-bot" }),
        stubCtx(),
      );

      const updateAction = findAction(actions, "operator.update");
      const result = await updateAction.handler(
        { operatorId: "updatable-bot", changes: { scopeMode: "shared" } },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
      if (!Result.isOk(result)) return;
      expect(
        (result.value as { config: { scopeMode: string } }).config.scopeMode,
      ).toBe("shared");
    });
  });

  describe("operator.remove", () => {
    test("removes operator, subsequent lookup fails", async () => {
      const createAction = findAction(actions, "operator.create");
      const created = await createAction.handler(
        makeConfig({ label: "Doomed" }),
        stubCtx(),
      );
      expect(Result.isOk(created)).toBe(true);
      if (!Result.isOk(created)) return;
      const id = (created.value as { id: string }).id;

      const removeAction = findAction(actions, "operator.remove");
      const removeResult = await removeAction.handler(
        { operatorId: id },
        stubCtx(),
      );
      expect(Result.isOk(removeResult)).toBe(true);
      if (!Result.isOk(removeResult)) return;
      expect(removeResult.value).toEqual({ removed: true });

      // List should exclude the removed operator
      const listAction = findAction(actions, "operator.list");
      const listResult = await listAction.handler({}, stubCtx());
      expect(Result.isOk(listResult)).toBe(true);
      if (!Result.isOk(listResult)) return;
      expect(listResult.value).toHaveLength(0);
    });

    test("supports label resolution for remove", async () => {
      const createAction = findAction(actions, "operator.create");
      await createAction.handler(
        makeConfig({ label: "removable-bot" }),
        stubCtx(),
      );

      const removeAction = findAction(actions, "operator.remove");
      const result = await removeAction.handler(
        { operatorId: "removable-bot" },
        stubCtx(),
      );
      expect(Result.isOk(result)).toBe(true);
    });

    test("has destroy intent", () => {
      const action = findAction(actions, "operator.remove");
      expect(action.intent).toBe("destroy");
    });
  });
});
