import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Result } from "better-result";
import type { HandlerContext } from "@xmtp/signet-contracts";
import type { SignetError, IdMappingStore } from "@xmtp/signet-schemas";
import { NotFoundError } from "@xmtp/signet-schemas";
import { SqliteIdentityStore } from "../identity-store.js";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
import type { ManagedClient } from "../client-registry.js";
import type { XmtpGroupInfo } from "../xmtp-client-factory.js";
import {
  createConversationActions,
  type ConversationActionDeps,
} from "../conversation-actions.js";
import { createConvosOnboardingScheme } from "../schemes/convos/onboarding-scheme.js";

function stubCtx(): HandlerContext {
  return {
    requestId: "example-test",
    signal: AbortSignal.timeout(5_000),
  };
}

describe("conversation action examples", () => {
  const onboardingScheme = createConvosOnboardingScheme();
  let identityStore: SqliteIdentityStore;
  let idMappings: IdMappingStore;
  let mappingDb: Database;
  let deps: ConversationActionDeps;

  beforeEach(() => {
    identityStore = new SqliteIdentityStore(":memory:");
    mappingDb = new Database(":memory:");
    idMappings = createSqliteIdMappingStore(mappingDb);

    const group: XmtpGroupInfo = {
      groupId: "resolved-network-group-id",
      name: "Example Group",
      description: "Example description",
      memberInboxIds: ["inbox-a", "inbox-b"],
      createdAt: "2026-03-30T00:00:00.000Z",
    };

    // Pre-store the mapping so conv_ examples resolve correctly
    idMappings.set(
      "resolved-network-group-id",
      "conv_0123456789abcdef",
      "conversation",
    );

    deps = {
      onboardingScheme,
      identityStore,
      getManagedClient: (_id: string): ManagedClient | undefined => undefined,
      getGroupInfo: async (groupId: string) =>
        groupId === group.groupId
          ? Result.ok(group)
          : Result.err(NotFoundError.create("group", groupId) as SignetError),
      idMappings,
    };
  });

  afterEach(() => {
    identityStore.close();
    mappingDb.close();
  });

  test("chat.info examples execute and match the declared output schema", async () => {
    const action = createConversationActions(deps).find(
      (candidate) => candidate.id === "chat.info",
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

  test("chat.members examples execute and match the declared output schema", async () => {
    const action = createConversationActions(deps).find(
      (candidate) => candidate.id === "chat.members",
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
