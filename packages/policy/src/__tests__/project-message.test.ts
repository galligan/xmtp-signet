import { describe, test, expect } from "bun:test";
import { projectMessage } from "../pipeline/project-message.js";
import type { ContentTypeId } from "@xmtp/signet-schemas";
import {
  createTestRawMessage,
  createFullScopes,
  createChatIds,
} from "./fixtures.js";

describe("projectMessage", () => {
  const baseAllowlist = new Set([
    "xmtp.org/text:1.0" as ContentTypeId,
    "xmtp.org/reaction:1.0" as ContentTypeId,
  ]);

  test("emits message when all stages pass with read-messages scope", () => {
    const message = createTestRawMessage();
    const scopes = createFullScopes();
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.messageId).toBe("msg-1");
      expect(result.event.visibility).toBe("visible");
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("drops message when chat is out of scope", () => {
    const message = createTestRawMessage({ groupId: "group-other" });
    const scopes = createFullScopes();
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("drop");
  });

  test("drops message when content type is not allowed", () => {
    const message = createTestRawMessage({
      contentType: "xmtp.org/readReceipt:1.0" as ContentTypeId,
    });
    const allowlist = new Set(["xmtp.org/text:1.0" as ContentTypeId]);
    const result = projectMessage(
      message,
      createFullScopes(),
      createChatIds("group-1"),
      allowlist,
      false,
    );

    expect(result.action).toBe("drop");
  });

  test("drops message when visibility resolves to hidden (no read-messages, no reveal)", () => {
    const message = createTestRawMessage();
    const scopes = new Set<string>(); // no read-messages
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("drop");
  });

  test("emits revealed message when no read-messages but has reveal", () => {
    const message = createTestRawMessage();
    const scopes = new Set<string>(); // no read-messages
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      true,
    );

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("revealed");
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("drops historical message when read-history scope is missing", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const scopes = new Set(["read-messages"]); // has read-messages but NOT read-history
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("drop");
  });

  test("emits historical message when read-history scope is present", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const scopes = new Set(["read-messages", "read-history"]);
    const chatIds = createChatIds("group-1");
    const result = projectMessage(
      message,
      scopes,
      chatIds,
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("historical");
    }
  });

  test("preserves metadata in emitted events", () => {
    const message = createTestRawMessage();
    const result = projectMessage(
      message,
      createFullScopes(),
      createChatIds("group-1"),
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.senderInboxId).toBe("sender-1");
      expect(result.event.contentType).toBe("xmtp.org/text:1.0");
      expect(result.event.sentAt).toBe("2024-01-01T00:00:00Z");
    }
  });
});
