import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { decodeProfileSnapshot } from "@xmtp/signet-core";
import { InternalError, ValidationError } from "@xmtp/signet-schemas";
import { createInviteHostEffects } from "../invite-host-effects.js";
import type {
  ManagedInviteJoinAcceptance,
  ManagedInviteJoinFailure,
} from "../invite-host-listener.js";
import type { AuditEntry } from "../audit/log.js";

function makeAcceptance(): ManagedInviteJoinAcceptance {
  return {
    join: {
      groupId: "group-1",
      requesterInboxId: "eeff0011",
      inviteTag: "tag-123",
    },
    hostIdentityId: "identity-host",
    hostInboxId: "aabbccdd",
    requestMessage: {
      type: "raw.message",
      messageId: "dm-msg-1",
      groupId: "dm-1",
      senderInboxId: "eeff0011",
      contentType: "join_request",
      content: {
        inviteSlug: "slug",
        profile: { name: "Codex", memberKind: "agent" },
      },
      sentAt: "2026-04-15T15:00:00.000Z",
      threadId: null,
      isHistorical: false,
    },
  };
}

function makeFailure(
  error: ManagedInviteJoinFailure["error"],
): ManagedInviteJoinFailure {
  return {
    error,
    requestMessage: {
      type: "raw.message",
      messageId: "dm-msg-2",
      groupId: "dm-2",
      senderInboxId: "eeff0011",
      contentType: "join_request",
      content: { inviteSlug: "slug" },
      sentAt: "2026-04-15T15:00:00.000Z",
      threadId: null,
      isHistorical: false,
    },
  };
}

describe("createInviteHostEffects", () => {
  test("records accepted joins and emits a fallback profile snapshot", async () => {
    const entries: AuditEntry[] = [];
    const sentMessages: Array<{ content: unknown; contentType?: string }> = [];

    const effects = createInviteHostEffects({
      auditLog: {
        path: ":memory:",
        async append(entry) {
          entries.push(entry);
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      getManagedClientForGroup() {
        return {
          async getGroupInfo() {
            return Result.ok({
              groupId: "group-1",
              name: "Hosted chat",
              description: "",
              memberInboxIds: ["aabbccdd", "eeff0011"],
              createdAt: "2026-04-15T15:00:00.000Z",
            });
          },
          async listMessages() {
            return Result.ok([]);
          },
          async sendMessage(_groupId, content, contentType) {
            sentMessages.push({ content, contentType });
            return Result.ok("snapshot-msg-1");
          },
        };
      },
      resolveLocalChatId: () => "conv_local_1",
      now: () => new Date("2026-04-15T15:00:00.000Z"),
    });

    await effects.onJoinAccepted(makeAcceptance());

    expect(entries.map((entry) => entry.action)).toEqual([
      "convos.join-request.accepted",
      "convos.profile-snapshot.sent",
    ]);
    expect(entries[0]?.detail).toMatchObject({
      groupId: "group-1",
      localChatId: "conv_local_1",
      inviteTag: "tag-123",
      joinerInboxId: "eeff0011",
      hostInboxId: "aabbccdd",
      dmId: "dm-1",
      requestMessageId: "dm-msg-1",
    });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.contentType).toBe(
      "convos.org/profile_snapshot:1.0",
    );
    expect(
      decodeProfileSnapshot(
        sentMessages[0]?.content as Parameters<typeof decodeProfileSnapshot>[0],
      ),
    ).toEqual({
      profiles: [
        { inboxId: "aabbccdd" },
        { inboxId: "eeff0011", name: "Codex", memberKind: 1 },
      ],
    });
  });

  test("pages profile history so older member profiles survive a new snapshot", async () => {
    const sentMessages: Array<{ content: unknown; contentType?: string }> = [];
    const listCalls: Array<string | undefined> = [];

    const fillerMessages = Array.from({ length: 500 }, (_, index) => ({
      messageId: `filler-${index + 1}`,
      groupId: "group-1",
      senderInboxId: "noise",
      contentType: "text",
      content: `noise-${index + 1}`,
      sentAt: new Date(
        Date.UTC(2026, 3, 15, 15, 0, 0, 500 - index),
      ).toISOString(),
      threadId: null,
    }));
    const olderProfileMessage = {
      messageId: "older-profile-msg-1",
      groupId: "group-1",
      senderInboxId: "11223344",
      contentType: "convos.org/profile_update:1.0",
      content: { name: "Existing member" },
      sentAt: "2026-04-15T14:59:00.000Z",
      threadId: null,
    };

    const effects = createInviteHostEffects({
      auditLog: {
        path: ":memory:",
        async append() {},
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      getManagedClientForGroup() {
        return {
          async getGroupInfo() {
            return Result.ok({
              groupId: "group-1",
              name: "Hosted chat",
              description: "",
              memberInboxIds: ["aabbccdd", "11223344", "eeff0011"],
              createdAt: "2026-04-15T15:00:00.000Z",
            });
          },
          async listMessages(_groupId, options) {
            listCalls.push(options?.before);
            if (!options?.before) {
              return Result.ok(fillerMessages);
            }
            return Result.ok([olderProfileMessage]);
          },
          async sendMessage(_groupId, content, contentType) {
            sentMessages.push({ content, contentType });
            return Result.ok("snapshot-msg-2");
          },
        };
      },
      now: () => new Date("2026-04-15T15:00:00.000Z"),
    });

    await effects.onJoinAccepted(makeAcceptance());

    expect(listCalls).toHaveLength(2);
    expect(
      decodeProfileSnapshot(
        sentMessages[0]?.content as Parameters<typeof decodeProfileSnapshot>[0],
      ),
    ).toEqual({
      profiles: [
        { inboxId: "aabbccdd" },
        { inboxId: "11223344", name: "Existing member" },
        { inboxId: "eeff0011", name: "Codex", memberKind: 1 },
      ],
    });
  });

  test("keeps paging past sparse snapshots to recover older member profiles", async () => {
    const sentMessages: Array<{ content: unknown; contentType?: string }> = [];
    const listCalls: Array<string | undefined> = [];

    const fillerMessages = Array.from({ length: 499 }, (_, index) => ({
      messageId: `sparse-filler-${index + 1}`,
      groupId: "group-1",
      senderInboxId: "noise",
      contentType: "text",
      content: `noise-${index + 1}`,
      sentAt: new Date(
        Date.UTC(2026, 3, 15, 14, 59, 59, 999 - index),
      ).toISOString(),
      threadId: null,
    }));
    const sparseSnapshotMessage = {
      messageId: "sparse-snapshot-1",
      groupId: "group-1",
      senderInboxId: "aabbccdd",
      contentType: "convos.org/profile_snapshot:1.0",
      content: {
        profiles: [
          { inboxId: "aabbccdd" },
          { inboxId: "11223344" },
          { inboxId: "eeff0011" },
        ],
      },
      sentAt: "2026-04-15T15:00:00.000Z",
      threadId: null,
    };
    const olderProfileMessage = {
      messageId: "older-profile-msg-2",
      groupId: "group-1",
      senderInboxId: "11223344",
      contentType: "convos.org/profile_update:1.0",
      content: { name: "Recovered member" },
      sentAt: "2026-04-15T14:59:00.000Z",
      threadId: null,
    };

    const effects = createInviteHostEffects({
      auditLog: {
        path: ":memory:",
        async append() {},
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      getManagedClientForGroup() {
        return {
          async getGroupInfo() {
            return Result.ok({
              groupId: "group-1",
              name: "Hosted chat",
              description: "",
              memberInboxIds: ["aabbccdd", "11223344", "eeff0011"],
              createdAt: "2026-04-15T15:00:00.000Z",
            });
          },
          async listMessages(_groupId, options) {
            listCalls.push(options?.before);
            if (!options?.before) {
              return Result.ok([sparseSnapshotMessage, ...fillerMessages]);
            }
            return Result.ok([olderProfileMessage]);
          },
          async sendMessage(_groupId, content, contentType) {
            sentMessages.push({ content, contentType });
            return Result.ok("snapshot-msg-3");
          },
        };
      },
      now: () => new Date("2026-04-15T15:00:00.000Z"),
    });

    await effects.onJoinAccepted(makeAcceptance());

    expect(listCalls).toHaveLength(2);
    expect(
      decodeProfileSnapshot(
        sentMessages[0]?.content as Parameters<typeof decodeProfileSnapshot>[0],
      ),
    ).toEqual({
      profiles: [
        { inboxId: "aabbccdd" },
        { inboxId: "11223344", name: "Recovered member" },
        { inboxId: "eeff0011", name: "Codex", memberKind: 1 },
      ],
    });
  });

  test("records validation failures as rejected joins", async () => {
    const entries: AuditEntry[] = [];
    const effects = createInviteHostEffects({
      auditLog: {
        path: ":memory:",
        async append(entry) {
          entries.push(entry);
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      getManagedClientForGroup: () => undefined,
      now: () => new Date("2026-04-15T15:00:00.000Z"),
    });

    await effects.onJoinRejected(
      makeFailure(ValidationError.create("invite", "Invite tag did not match")),
    );

    expect(entries[0]?.action).toBe("convos.join-request.rejected");
    expect(entries[0]?.detail).toMatchObject({
      dmId: "dm-2",
      joinerInboxId: "eeff0011",
      errorCategory: "validation",
    });
  });

  test("records transient failures separately from validation rejections", async () => {
    const entries: AuditEntry[] = [];
    const effects = createInviteHostEffects({
      auditLog: {
        path: ":memory:",
        async append(entry) {
          entries.push(entry);
        },
        async tail() {
          return [];
        },
        async readAll() {
          return [];
        },
      },
      getManagedClientForGroup: () => undefined,
      now: () => new Date("2026-04-15T15:00:00.000Z"),
    });

    await effects.onJoinRejected(
      makeFailure(InternalError.create("temporary addMembers failure")),
    );

    expect(entries[0]?.action).toBe("convos.join-request.failed");
    expect(entries[0]?.detail).toMatchObject({
      errorCategory: "internal",
    });
  });
});
