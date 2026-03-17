import { describe, test, expect } from "bun:test";
import {
  validateSendMessage,
  validateSendReply,
} from "../grant/validate-send.js";
import { Result } from "better-result";
import type { ContentTypeId } from "@xmtp/signet-schemas";
import {
  createFullGrant,
  createDenyAllGrant,
  createPassthroughView,
} from "./fixtures.js";

describe("validateSendMessage", () => {
  test("succeeds when messaging.send is true", () => {
    const result = validateSendMessage(
      { groupId: "group-1", contentType: "xmtp.org/text:1.0" as ContentTypeId },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.draftOnly).toBe(false);
    }
  });

  test("returns GrantDeniedError when messaging.send is false", () => {
    const result = validateSendMessage(
      { groupId: "group-1", contentType: "xmtp.org/text:1.0" as ContentTypeId },
      createDenyAllGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("GrantDeniedError");
    }
  });

  test("returns PermissionError when group not in view", () => {
    const result = validateSendMessage(
      {
        groupId: "group-other",
        contentType: "xmtp.org/text:1.0" as ContentTypeId,
      },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("PermissionError");
    }
  });

  test("returns draftOnly true when messaging.draftOnly is true", () => {
    const grant = {
      ...createFullGrant(),
      messaging: { send: true, reply: true, react: true, draftOnly: true },
    };
    const result = validateSendMessage(
      { groupId: "group-1", contentType: "xmtp.org/text:1.0" as ContentTypeId },
      grant,
      createPassthroughView("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.draftOnly).toBe(true);
    }
  });
});

describe("validateSendReply", () => {
  test("succeeds when messaging.reply is true", () => {
    const result = validateSendReply(
      {
        groupId: "group-1",
        messageId: "msg-1",
        contentType: "xmtp.org/text:1.0" as ContentTypeId,
      },
      createFullGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.draftOnly).toBe(false);
    }
  });

  test("returns GrantDeniedError when messaging.reply is false", () => {
    const result = validateSendReply(
      {
        groupId: "group-1",
        messageId: "msg-1",
        contentType: "xmtp.org/text:1.0" as ContentTypeId,
      },
      createDenyAllGrant(),
      createPassthroughView("group-1"),
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("GrantDeniedError");
    }
  });

  test("returns draftOnly true when messaging.draftOnly is true", () => {
    const grant = {
      ...createFullGrant(),
      messaging: { send: true, reply: true, react: true, draftOnly: true },
    };
    const result = validateSendReply(
      {
        groupId: "group-1",
        messageId: "msg-1",
        contentType: "xmtp.org/text:1.0" as ContentTypeId,
      },
      grant,
      createPassthroughView("group-1"),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.draftOnly).toBe(true);
    }
  });
});
