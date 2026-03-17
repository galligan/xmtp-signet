/**
 * Policy enforcement integration tests.
 *
 * Validates view filtering, grant checking, content type filtering,
 * and materiality detection across the policy and sessions packages.
 */

import { describe, test, expect } from "bun:test";
import type {
  ViewConfig,
  GrantConfig,
  ContentTypeId,
} from "@xmtp/signet-schemas";
import { BASELINE_CONTENT_TYPES } from "@xmtp/signet-schemas";
import {
  projectMessage,
  resolveEffectiveAllowlist,
  validateSendMessage,
  validateSendReaction,
  validateGroupManagement,
  isMaterialChange,
  requiresReauthorization,
} from "@xmtp/signet-policy";
import type { RawMessage, SignetContentTypeConfig } from "@xmtp/signet-policy";
import type { PolicyDelta } from "@xmtp/signet-contracts";
import { checkMateriality } from "@xmtp/signet-sessions";

const GROUP_ID = "policy-group-1";

/** Signet config that allows all baseline types. */
const SIGNET_CONFIG: SignetContentTypeConfig = {
  allowlist: new Set<ContentTypeId>(BASELINE_CONTENT_TYPES),
};

function computeAllowlist(contentTypes: readonly ContentTypeId[]) {
  const result = resolveEffectiveAllowlist(
    [...BASELINE_CONTENT_TYPES],
    SIGNET_CONFIG,
    contentTypes,
  );
  if (!result.isOk()) {
    throw new Error(`Allowlist resolution failed: ${result.error.message}`);
  }
  return result.value;
}

function makeRawMessage(overrides?: Partial<RawMessage>): RawMessage {
  return {
    messageId: `msg_${crypto.randomUUID()}`,
    groupId: GROUP_ID,
    senderInboxId: "sender-inbox",
    contentType: "xmtp.org/text:1.0",
    content: { text: "hello" },
    sentAt: new Date().toISOString(),
    threadId: null,
    sealId: null,
    ...overrides,
  };
}

function makeView(mode: ViewConfig["mode"] = "full"): ViewConfig {
  return {
    mode,
    threadScopes: [{ groupId: GROUP_ID, threadId: null }],
    contentTypes: ["xmtp.org/text:1.0", "xmtp.org/reaction:1.0"],
  };
}

function makeGrant(overrides?: Partial<GrantConfig["messaging"]>): GrantConfig {
  return {
    messaging: {
      send: true,
      reply: true,
      react: true,
      draftOnly: false,
      ...overrides,
    },
    groupManagement: {
      addMembers: false,
      removeMembers: false,
      updateMetadata: false,
      inviteUsers: false,
    },
    tools: { scopes: [] },
    egress: {
      storeExcerpts: false,
      useForMemory: false,
      forwardToProviders: false,
      quoteRevealed: false,
      summarize: false,
    },
  };
}

describe("policy-enforcement", () => {
  describe("view projection", () => {
    test("full mode passes all messages", () => {
      const view = makeView("full");
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage();

      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("emit");
      if (result.action !== "emit") return;
      expect(result.event.messageId).toBe(msg.messageId);
      expect(result.event.visibility).toBe("visible");
      expect(result.event.content).toEqual({ text: "hello" });
    });

    test("redacted mode strips content", () => {
      const view = makeView("redacted");
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage();

      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("emit");
      if (result.action !== "emit") return;
      expect(result.event.visibility).toBe("redacted");
      // Redacted content is null
      expect(result.event.content).toBeNull();
    });

    test("reveal-only mode drops non-revealed messages", () => {
      const view = makeView("reveal-only");
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage();

      // Not revealed -> dropped
      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("drop");

      // Revealed -> passes
      const revealed = projectMessage(msg, view, allowlist, true);
      expect(revealed.action).toBe("emit");
      if (revealed.action !== "emit") return;
      expect(revealed.event.visibility).toBe("revealed");
    });

    test("thread-only mode drops messages from other groups", () => {
      const view: ViewConfig = {
        mode: "full",
        threadScopes: [{ groupId: "other-group", threadId: null }],
        contentTypes: ["xmtp.org/text:1.0"],
      };
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage({ groupId: GROUP_ID });

      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("drop");
    });
  });

  describe("content type filtering", () => {
    test("allowed content type passes", () => {
      const view = makeView();
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage({ contentType: "xmtp.org/text:1.0" });

      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("emit");
    });

    test("disallowed content type is dropped", () => {
      const view = makeView();
      const allowlist = computeAllowlist(view.contentTypes);
      const msg = makeRawMessage({
        contentType: "xmtp.org/readReceipt:1.0",
      });

      const result = projectMessage(msg, view, allowlist, false);
      expect(result.action).toBe("drop");
    });
  });

  describe("grant enforcement", () => {
    test("send allowed when grant.messaging.send is true", () => {
      const grant = makeGrant({ send: true });
      const view = makeView();
      const result = validateSendMessage(
        { groupId: GROUP_ID, contentType: "xmtp.org/text:1.0" },
        grant,
        view,
      );
      expect(result.isOk()).toBe(true);
    });

    test("send denied when grant.messaging.send is false", () => {
      const grant = makeGrant({ send: false });
      const view = makeView();
      const result = validateSendMessage(
        { groupId: GROUP_ID, contentType: "xmtp.org/text:1.0" },
        grant,
        view,
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("GrantDeniedError");
    });

    test("react allowed when grant.messaging.react is true", () => {
      const grant = makeGrant({ react: true });
      const view = makeView();
      const result = validateSendReaction(
        { groupId: GROUP_ID, messageId: "msg-1" },
        grant,
        view,
      );
      expect(result.isOk()).toBe(true);
    });

    test("react denied when grant.messaging.react is false", () => {
      const grant = makeGrant({ react: false });
      const view = makeView();
      const result = validateSendReaction(
        { groupId: GROUP_ID, messageId: "msg-1" },
        grant,
        view,
      );
      expect(result.isErr()).toBe(true);
    });

    test("group management denied when not granted", () => {
      const grant = makeGrant();
      const view = makeView();
      const result = validateGroupManagement(
        "addMembers",
        { groupId: GROUP_ID },
        grant,
        view,
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("GrantDeniedError");
    });
  });

  describe("materiality detection", () => {
    test("view mode escalation is material", () => {
      const result = checkMateriality(
        makeView("redacted"),
        makeGrant(),
        makeView("full"),
        makeGrant(),
      );
      expect(result.isMaterial).toBe(true);
    });

    test("grant escalation (false -> true) is material", () => {
      const result = checkMateriality(
        makeView(),
        makeGrant({ send: false }),
        makeView(),
        makeGrant({ send: true }),
      );
      expect(result.isMaterial).toBe(true);
    });

    test("no change is not material", () => {
      const view = makeView();
      const grant = makeGrant();
      const result = checkMateriality(view, grant, view, grant);
      expect(result.isMaterial).toBe(false);
    });

    test("policy isMaterialChange recognizes escalation deltas", () => {
      const delta: PolicyDelta = {
        viewChanges: [{ field: "view.mode", from: "redacted", to: "full" }],
        grantChanges: [],
        contentTypeChanges: { added: [], removed: [] },
      };
      expect(isMaterialChange([delta])).toBe(true);
      expect(requiresReauthorization([delta])).toBe(true);
    });
  });
});
