import { describe, test, expect } from "bun:test";
import { projectMessage } from "../pipeline/project-message.js";
import type { ContentTypeId } from "@xmtp/signet-schemas";
import {
  createTestRawMessage,
  createFullScopes,
  createChatIds,
} from "./fixtures.js";

describe("historical message visibility", () => {
  const baseAllowlist = new Set([
    "xmtp.org/text:1.0" as ContentTypeId,
    "xmtp.org/reaction:1.0" as ContentTypeId,
  ]);

  test("historical message gets visibility 'historical' with read-history", () => {
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
      expect(result.event.content).toEqual({ text: "hello" });
    }
  });

  test("historical message is dropped without read-history scope", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const scopes = new Set(["read-messages"]); // no read-history
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

  test("non-historical message preserves normal visibility", () => {
    const message = createTestRawMessage({ isHistorical: false });
    const result = projectMessage(
      message,
      createFullScopes(),
      createChatIds("group-1"),
      baseAllowlist,
      false,
    );

    expect(result.action).toBe("emit");
    if (result.action === "emit") {
      expect(result.event.visibility).toBe("visible");
    }
  });

  test("historical flag defaults to false when omitted", () => {
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
      expect(result.event.visibility).toBe("visible");
    }
  });

  test("historical message preserves metadata", () => {
    const message = createTestRawMessage({ isHistorical: true });
    const scopes = new Set(["read-messages", "read-history"]);
    const result = projectMessage(
      message,
      scopes,
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
