import { describe, test, expect } from "bun:test";
import { projectMessage } from "../pipeline/project-message.js";
import type { ContentTypeId, ViewConfig } from "@xmtp-broker/schemas";
import { createTestRawMessage, createPassthroughView } from "./fixtures.js";

describe("projectMessage", () => {
  const baseAllowlist = new Set([
    "xmtp.org/text:1.0" as ContentTypeId,
    "xmtp.org/reaction:1.0" as ContentTypeId,
  ]);

  test("emits message when all stages pass with full mode", () => {
    const message = createTestRawMessage();
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.messageId).toBe("msg-1");
      expect(result.event.visibility).toBe("visible");
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("drops message when group is out of scope", () => {
    const message = createTestRawMessage({ groupId: "group-other" });
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("drop");
  });

  test("drops message when content type is not allowed", () => {
    const message = createTestRawMessage({
      contentType: "xmtp.org/readReceipt:1.0" as ContentTypeId,
    });
    const view = createPassthroughView("group-1");
    const allowlist = new Set(["xmtp.org/text:1.0" as ContentTypeId]);
    const result = projectMessage(message, view, allowlist, false);

    expect(result.action).toBe("drop");
  });

  test("drops message when visibility resolves to hidden (reveal-only, no reveal)", () => {
    const message = createTestRawMessage();
    const view: ViewConfig = {
      mode: "reveal-only",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("drop");
  });

  test("emits revealed message when reveal-only mode with reveal", () => {
    const message = createTestRawMessage();
    const view: ViewConfig = {
      mode: "reveal-only",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, true);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("revealed");
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("emits redacted message with null content in redacted mode", () => {
    const message = createTestRawMessage();
    const view: ViewConfig = {
      mode: "redacted",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("redacted");
      expect(result.event.content).toBeNull();
    }
  });

  test("preserves metadata in redacted messages", () => {
    const message = createTestRawMessage();
    const view: ViewConfig = {
      mode: "redacted",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.senderInboxId).toBe("sender-1");
      expect(result.event.contentType).toBe("xmtp.org/text:1.0");
      expect(result.event.sentAt).toBe("2024-01-01T00:00:00Z");
    }
  });
});
