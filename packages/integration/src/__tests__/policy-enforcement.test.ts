/**
 * Policy enforcement integration tests.
 *
 * Validates message projection, scope checks, content type filtering,
 * and materiality detection across the policy and sessions packages.
 */

import { describe, test, expect } from "bun:test";
import {
  BASELINE_CONTENT_TYPES,
  resolveScopeSet,
  type ContentTypeId,
  type ScopeSetType,
} from "@xmtp/signet-schemas";
import {
  isMaterialChange,
  projectMessage,
  requiresReauthorization,
  resolveEffectiveAllowlist,
  validateGroupManagement,
  validateSendMessage,
  validateSendReaction,
} from "@xmtp/signet-policy";
import { checkMateriality } from "@xmtp/signet-sessions";
import type { RawMessage, SignetContentTypeConfig } from "@xmtp/signet-policy";
import type { PolicyDelta } from "@xmtp/signet-contracts";

const GROUP_ID = "conv_1234abcdfeedbabe";

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
    messageId: "msg_1234abcdfeedbabe",
    groupId: GROUP_ID,
    senderInboxId: "inbox_sender",
    contentType: "xmtp.org/text:1.0",
    content: { text: "hello" },
    sentAt: new Date().toISOString(),
    threadId: null,
    sealId: null,
    ...overrides,
  };
}

function makeScopeSet(overrides?: Partial<ScopeSetType>): ScopeSetType {
  return {
    allow: ["send", "reply", "react", "read-messages"],
    deny: [],
    ...overrides,
  };
}

describe("policy-enforcement", () => {
  describe("message projection", () => {
    test("visible messages pass through when read-messages is allowed", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage();

      const result = projectMessage(msg, scopes, [GROUP_ID], allowlist, false);
      expect(result.action).toBe("emit");
      if (result.action !== "emit") return;
      expect(result.event.visibility).toBe("visible");
      expect(result.event.content).toEqual({ text: "hello" });
    });

    test("messages are dropped when read-messages is absent and not revealed", () => {
      const scopes = resolveScopeSet({
        allow: ["send"],
        deny: [],
      });
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage();

      const result = projectMessage(msg, scopes, [GROUP_ID], allowlist, false);
      expect(result.action).toBe("drop");
    });

    test("revealed messages surface without read-messages scope", () => {
      const scopes = resolveScopeSet({
        allow: ["send"],
        deny: [],
      });
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage();

      const result = projectMessage(msg, scopes, [GROUP_ID], allowlist, true);
      expect(result.action).toBe("emit");
      if (result.action !== "emit") return;
      expect(result.event.visibility).toBe("revealed");
      expect(result.event.content).toEqual({ text: "hello" });
    });

    test("messages outside scoped chats are dropped", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage();

      const result = projectMessage(
        msg,
        scopes,
        ["conv_deadbeeffeedbabe"],
        allowlist,
        false,
      );
      expect(result.action).toBe("drop");
    });

    test("historical messages require read-history scope", () => {
      const withoutHistory = resolveScopeSet({
        allow: ["read-messages"],
        deny: [],
      });
      const withHistory = resolveScopeSet({
        allow: ["read-messages", "read-history"],
        deny: [],
      });
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage({ isHistorical: true });

      const dropped = projectMessage(
        msg,
        withoutHistory,
        [GROUP_ID],
        allowlist,
        false,
      );
      expect(dropped.action).toBe("drop");

      const historical = projectMessage(
        msg,
        withHistory,
        [GROUP_ID],
        allowlist,
        false,
      );
      expect(historical.action).toBe("emit");
      if (historical.action !== "emit") return;
      expect(historical.event.visibility).toBe("historical");
    });
  });

  describe("content type filtering", () => {
    test("allowed content type passes", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage({ contentType: "xmtp.org/text:1.0" });

      const result = projectMessage(msg, scopes, [GROUP_ID], allowlist, false);
      expect(result.action).toBe("emit");
    });

    test("disallowed content type is dropped", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const allowlist = computeAllowlist(["xmtp.org/text:1.0"]);
      const msg = makeRawMessage({
        contentType: "xmtp.org/readReceipt:1.0",
      });

      const result = projectMessage(msg, scopes, [GROUP_ID], allowlist, false);
      expect(result.action).toBe("drop");
    });
  });

  describe("scope enforcement", () => {
    test("send allowed when send scope is present", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const result = validateSendMessage({ groupId: GROUP_ID }, scopes, [
        GROUP_ID,
      ]);
      expect(result.isOk()).toBe(true);
    });

    test("send denied when send scope is absent", () => {
      const scopes = resolveScopeSet({
        allow: ["read-messages"],
        deny: [],
      });
      const result = validateSendMessage({ groupId: GROUP_ID }, scopes, [
        GROUP_ID,
      ]);
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("PermissionError");
    });

    test("reaction allowed when react scope is present", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const result = validateSendReaction({ groupId: GROUP_ID }, scopes, [
        GROUP_ID,
      ]);
      expect(result.isOk()).toBe(true);
    });

    test("group management denied when scope is absent", () => {
      const scopes = resolveScopeSet(makeScopeSet());
      const result = validateGroupManagement(
        "add-member",
        { groupId: GROUP_ID },
        scopes,
        [GROUP_ID],
      );
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error._tag).toBe("PermissionError");
    });
  });

  describe("materiality detection", () => {
    test("scope addition is material and requires reauthorization", () => {
      const result = checkMateriality(
        { allow: ["read-messages"], deny: [] },
        { allow: ["read-messages", "send"], deny: [] },
      );
      expect(result.isMaterial).toBe(true);
      expect(result.requiresReauthorization).toBe(true);
    });

    test("no change is not material", () => {
      const scopes = {
        allow: ["read-messages"],
        deny: [],
      } satisfies ScopeSetType;
      const result = checkMateriality(scopes, scopes);
      expect(result.isMaterial).toBe(false);
      expect(result.requiresReauthorization).toBe(false);
    });

    test("policy delta helpers classify escalations", () => {
      const delta: PolicyDelta = {
        added: ["send"],
        removed: [],
        changed: [{ scope: "read-messages", from: "deny", to: "allow" }],
      };
      expect(isMaterialChange(delta)).toBe(true);
      expect(requiresReauthorization(delta)).toBe(true);
    });
  });
});
