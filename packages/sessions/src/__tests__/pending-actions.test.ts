import { describe, expect, test, beforeEach } from "bun:test";
import {
  createPendingActionStore,
  type PendingAction,
  type PendingActionStore,
} from "../pending-actions.js";

function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    actionId: "act_1",
    credentialId: "cred_abc12345feedbabe",
    actionType: "send_message",
    payload: { chatId: "conv_g1", content: "hello" },
    createdAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T00:05:00Z",
    ...overrides,
  };
}

let store: PendingActionStore;

beforeEach(() => {
  store = createPendingActionStore();
});

describe("createPendingActionStore", () => {
  test("add and get returns the action", () => {
    const action = makeAction();
    store.add(action);
    expect(store.get("act_1")).toEqual(action);
  });

  test("get returns null for unknown actionId", () => {
    expect(store.get("unknown")).toBeNull();
  });

  test("confirm removes and returns the action", () => {
    const action = makeAction();
    store.add(action);
    const confirmed = store.confirm("act_1");
    expect(confirmed).toEqual(action);
    expect(store.get("act_1")).toBeNull();
  });

  test("confirm returns null for unknown actionId", () => {
    expect(store.confirm("unknown")).toBeNull();
  });

  test("deny removes and returns the action", () => {
    const action = makeAction();
    store.add(action);
    const denied = store.deny("act_1");
    expect(denied).toEqual(action);
    expect(store.get("act_1")).toBeNull();
  });

  test("deny returns null for unknown actionId", () => {
    expect(store.deny("unknown")).toBeNull();
  });

  test("expireStale removes expired actions and returns them", () => {
    const expired = makeAction({
      actionId: "act_expired",
      expiresAt: "2024-01-01T00:04:00Z",
    });
    store.add(expired);
    store.add(
      makeAction({
        actionId: "act_valid",
        expiresAt: "2024-01-01T00:10:00Z",
      }),
    );

    const removed = store.expireStale(new Date("2024-01-01T00:05:00Z"));
    expect(removed).toHaveLength(1);
    expect(removed[0]!.actionId).toBe("act_expired");
    expect(store.get("act_expired")).toBeNull();
    expect(store.get("act_valid")).not.toBeNull();
  });

  test("expireStale returns empty array when nothing expired", () => {
    store.add(makeAction({ expiresAt: "2024-12-31T23:59:59Z" }));
    const removed = store.expireStale(new Date("2024-01-01T00:00:00Z"));
    expect(removed).toHaveLength(0);
  });

  test("listByCredential filters by credentialId", () => {
    store.add(
      makeAction({
        actionId: "act_a",
        credentialId: "cred_abc12345feedbabe",
      }),
    );
    store.add(
      makeAction({
        actionId: "act_b",
        credentialId: "cred_xyz67890",
      }),
    );
    store.add(
      makeAction({
        actionId: "act_c",
        credentialId: "cred_abc12345feedbabe",
      }),
    );

    const credActions = store.listByCredential("cred_abc12345feedbabe");
    expect(credActions).toHaveLength(2);
    expect(credActions.map((a) => a.actionId).sort()).toEqual([
      "act_a",
      "act_c",
    ]);
  });

  test("listByCredential returns empty array for unknown credential", () => {
    expect(store.listByCredential("unknown")).toEqual([]);
  });
});
