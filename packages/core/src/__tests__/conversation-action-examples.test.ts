import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { HandlerContext } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";
import { NotFoundError } from "@xmtp/signet-schemas";
import { SqliteIdentityStore } from "../identity-store.js";
import type { ManagedClient } from "../client-registry.js";
import type { XmtpGroupInfo } from "../xmtp-client-factory.js";
import {
  createConversationActions,
  type ConversationActionDeps,
} from "../conversation-actions.js";

function stubCtx(): HandlerContext {
  return {
    requestId: "example-test",
    signal: AbortSignal.timeout(5_000),
  };
}

describe("conversation action examples", () => {
  let identityStore: SqliteIdentityStore;
  let deps: ConversationActionDeps;

  beforeEach(() => {
    identityStore = new SqliteIdentityStore(":memory:");
    const group: XmtpGroupInfo = {
      groupId: "group-1",
      name: "Example Group",
      description: "Example description",
      memberInboxIds: ["inbox-a", "inbox-b"],
      createdAt: "2026-03-30T00:00:00.000Z",
    };

    deps = {
      identityStore,
      getManagedClient: (_id: string): ManagedClient | undefined => undefined,
      getGroupInfo: async (groupId: string) =>
        groupId === group.groupId
          ? Result.ok(group)
          : Result.err(NotFoundError.create("group", groupId) as SignetError),
    };
  });

  afterEach(() => {
    identityStore.close();
  });

  test("conversation.info examples execute and match the declared output schema", async () => {
    const action = createConversationActions(deps).find(
      (candidate) => candidate.id === "conversation.info",
    );

    expect(action?.examples?.length).toBeGreaterThan(0);
    expect(action?.output).toBeDefined();
    if (!action?.examples || !action.output) return;

    for (const example of action.examples) {
      const parsed = action.input.safeParse(example.input);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;

      const result = await action.handler(parsed.data, stubCtx());
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) continue;

      expect(result.value).toEqual(example.expected);
      expect(action.output.safeParse(result.value).success).toBe(true);
    }
  });

  test("conversation.members examples execute and match the declared output schema", async () => {
    const action = createConversationActions(deps).find(
      (candidate) => candidate.id === "conversation.members",
    );

    expect(action?.examples?.length).toBeGreaterThan(0);
    expect(action?.output).toBeDefined();
    if (!action?.examples || !action.output) return;

    for (const example of action.examples) {
      const parsed = action.input.safeParse(example.input);
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;

      const result = await action.handler(parsed.data, stubCtx());
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) continue;

      expect(result.value).toEqual(example.expected);
      expect(action.output.safeParse(result.value).success).toBe(true);
    }
  });
});
