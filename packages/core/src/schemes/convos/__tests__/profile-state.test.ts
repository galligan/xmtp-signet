import { describe, expect, test } from "bun:test";
import type { XmtpDecodedMessage } from "../../../xmtp-client-factory.js";
import { encodeProfileSnapshot, MemberKind } from "../profile-messages.js";
import {
  buildProfileSnapshotFromMessages,
  extractProfileSnapshotContent,
  extractProfileUpdateContent,
  resolveProfilesFromMessages,
} from "../profile-state.js";

function makeMessage(
  overrides?: Partial<XmtpDecodedMessage>,
): XmtpDecodedMessage {
  return {
    messageId: overrides?.messageId ?? "msg-1",
    groupId: overrides?.groupId ?? "group-1",
    senderInboxId: overrides?.senderInboxId ?? "inbox-a",
    contentType: overrides?.contentType ?? "text",
    content: overrides?.content ?? "hello",
    sentAt: overrides?.sentAt ?? "2026-04-15T14:00:00.000Z",
    threadId: overrides?.threadId ?? null,
  };
}

describe("profile-state", () => {
  test("prefers the latest profile update over older snapshots", () => {
    const messages = [
      makeMessage({
        messageId: "profile-update",
        senderInboxId: "inbox-a",
        contentType: "profile_update",
        content: { name: "Codex", memberKind: MemberKind.Agent },
        sentAt: "2026-04-15T14:05:00.000Z",
      }),
      makeMessage({
        messageId: "profile-snapshot",
        senderInboxId: "host",
        contentType: "profile_snapshot",
        content: {
          profiles: [
            { inboxId: "inbox-a", name: "Older Name" },
            { inboxId: "inbox-b", name: "Other Member" },
          ],
        },
        sentAt: "2026-04-15T14:00:00.000Z",
      }),
    ];

    const resolved = resolveProfilesFromMessages(messages, [
      "inbox-a",
      "inbox-b",
    ]);

    expect(resolved.get("inbox-a")).toEqual({
      inboxId: "inbox-a",
      name: "Codex",
      memberKind: MemberKind.Agent,
    });
    expect(resolved.get("inbox-b")).toEqual({
      inboxId: "inbox-b",
      name: "Other Member",
    });
  });

  test("can build fallback snapshot entries for unresolved members", () => {
    const snapshot = buildProfileSnapshotFromMessages(
      [],
      ["inbox-a", "inbox-b"],
      {
        includeFallbackEntries: true,
      },
    );

    expect(snapshot).toEqual({
      profiles: [{ inboxId: "inbox-a" }, { inboxId: "inbox-b" }],
    });
  });

  test("extracts profile updates and snapshots from encoded content", () => {
    const encodedSnapshot = encodeProfileSnapshot({
      profiles: [{ inboxId: "aabbccdd", name: "Codex" }],
    });

    expect(
      extractProfileUpdateContent({
        name: "Codex",
        memberKind: MemberKind.Agent,
      }),
    ).toEqual({
      name: "Codex",
      memberKind: MemberKind.Agent,
    });
    expect(extractProfileSnapshotContent(encodedSnapshot)).toEqual({
      profiles: [{ inboxId: "aabbccdd", name: "Codex" }],
    });
  });

  test("ignores malformed snapshot entries instead of throwing", () => {
    const messages = [
      makeMessage({
        messageId: "profile-snapshot",
        senderInboxId: "host",
        contentType: "profile_snapshot",
        content: {
          profiles: [{}, { inboxId: "inbox-b", name: "Other Member" }],
        },
      }),
    ];

    expect(() =>
      resolveProfilesFromMessages(messages, ["inbox-a", "inbox-b"]),
    ).not.toThrow();

    const resolved = resolveProfilesFromMessages(messages, [
      "inbox-a",
      "inbox-b",
    ]);
    expect(resolved.get("inbox-a")).toBeUndefined();
    expect(resolved.get("inbox-b")).toEqual({
      inboxId: "inbox-b",
      name: "Other Member",
    });
  });
});
