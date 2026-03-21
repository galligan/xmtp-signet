import { describe, test, expect } from "bun:test";
import { projectMessage } from "../pipeline/project-message.js";
import type { ContentTypeId, ViewConfig } from "@xmtp/signet-schemas";
import { createTestRawMessage, createPassthroughView } from "./fixtures.js";

describe("historical message visibility", () => {
  const baseAllowlist = new Set([
    "xmtp.org/text:1.0" as ContentTypeId,
    "xmtp.org/reaction:1.0" as ContentTypeId,
  ]);

  test("historical message gets visibility 'historical' in full mode", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("historical");
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("historical message gets visibility 'historical' in thread-only mode", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const view: ViewConfig = {
      mode: "thread-only",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("historical");
    }
  });

  test("historical message in redacted mode keeps redacted visibility", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const view: ViewConfig = {
      mode: "redacted",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("redacted");
    }
  });

  test("historical message in reveal-only mode is still dropped without reveal", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const view: ViewConfig = {
      mode: "reveal-only",
      threadScopes: [{ groupId: "group-1", threadId: null }],
      contentTypes: ["xmtp.org/text:1.0" as ContentTypeId],
    };
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("drop");
  });

  test("non-historical message preserves normal visibility", () => {
    const message = createTestRawMessage({ isHistorical: false });
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("visible");
    }
  });

  test("historical flag defaults to false when omitted", () => {
    const message = createTestRawMessage();
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("visible");
    }
  });

  test("historical message preserves metadata", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const view = createPassthroughView("group-1");
    const result = projectMessage(message, view, baseAllowlist, false);

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.senderInboxId).toBe("sender-1");
      expect(result.event.contentType).toBe("xmtp.org/text:1.0");
      expect(result.event.sentAt).toBe("2024-01-01T00:00:00Z");
    }
  });
});
