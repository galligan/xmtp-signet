import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { XmtpDecodedMessage } from "../../../xmtp-client-factory.js";
import { createConvosOnboardingScheme } from "../onboarding-scheme.js";
import {
  generateConvosInviteUrl,
  type GenerateInviteUrlOptions,
} from "../invite-generator.js";
import {
  parseConvosInviteUrl,
  verifyConvosInvite,
  type ParsedConvosInvite,
} from "../invite-parser.js";
import {
  encodeProfileSnapshot,
  encodeProfileUpdate,
  MemberKind,
  type MemberProfileEntry,
  type ProfileMetadata,
  type ProfileSnapshotContent,
  type ProfileUpdateContent,
} from "../profile-messages.js";
import { resolveProfilesFromMessages } from "../profile-state.js";
import { processJoinRequest } from "../process-join-requests.js";

const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_JOINER_INBOX_ID =
  "11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff";

function extractSlugFromUrl(url: string): string {
  const parsed = new URL(url);
  const slug = parsed.searchParams.get("i");
  if (!slug) {
    throw new Error(`Invite URL missing slug: ${url}`);
  }
  return slug;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function normalizeParsedInvite(
  invite:
    | ParsedConvosInvite
    | {
        readonly schemeId: string;
        readonly signedPayloadBytes: Uint8Array;
        readonly signatureBytes: Uint8Array;
        readonly conversationToken: Uint8Array;
        readonly creatorInboxId: string;
        readonly tag: string;
        readonly name?: string;
        readonly description?: string;
        readonly imageUrl?: string;
        readonly isExpired: boolean;
        readonly isConversationExpired: boolean;
        readonly expiresAfterUse: boolean;
      },
) {
  if ("schemeId" in invite) {
    return {
      schemeId: invite.schemeId,
      signedPayloadBytes: bytesToHex(invite.signedPayloadBytes),
      signatureBytes: bytesToHex(invite.signatureBytes),
      conversationToken: bytesToHex(invite.conversationToken),
      creatorInboxId: invite.creatorInboxId,
      tag: invite.tag,
      name: invite.name,
      description: invite.description,
      imageUrl: invite.imageUrl,
      isExpired: invite.isExpired,
      isConversationExpired: invite.isConversationExpired,
      expiresAfterUse: invite.expiresAfterUse,
    };
  }

  return {
    signedPayloadBytes: bytesToHex(invite.signedInvitePayloadBytes),
    signatureBytes: bytesToHex(invite.signedInviteSignature),
    conversationToken: bytesToHex(invite.conversationToken),
    creatorInboxId: invite.creatorInboxId,
    tag: invite.tag,
    name: invite.name,
    description: invite.description,
    imageUrl: invite.imageUrl,
    isExpired: invite.isExpired,
    isConversationExpired: invite.isConversationExpired,
    expiresAfterUse: invite.expiresAfterUse,
  };
}

function normalizeEncodedContent(content: {
  readonly type: {
    readonly authorityId: string;
    readonly typeId: string;
    readonly versionMajor: number;
    readonly versionMinor: number;
  };
  readonly parameters: Record<string, string>;
  readonly content: Uint8Array;
  readonly fallback?: string;
}) {
  return {
    type: `${content.type.authorityId}/${content.type.typeId}:${content.type.versionMajor}.${content.type.versionMinor}`,
    parameters: content.parameters,
    content: bytesToHex(content.content),
    fallback: content.fallback,
  };
}

function toConvosMetadata(
  metadata: Record<string, string | number | boolean>,
): ProfileMetadata {
  const result: ProfileMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    result[key] =
      typeof value === "string"
        ? { type: "string", value }
        : typeof value === "number"
          ? { type: "number", value }
          : { type: "bool", value };
  }
  return result;
}

function normalizeProfiles(
  profiles: Map<
    string,
    {
      readonly inboxId: string;
      readonly name?: string;
      readonly memberKind?: MemberKind | "agent" | "human";
      readonly metadata?:
        | ProfileMetadata
        | Record<string, string | number | boolean>;
    }
  >,
) {
  return Array.from(profiles.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([inboxId, profile]) => ({
      inboxId,
      name: profile.name,
      memberKind:
        profile.memberKind === MemberKind.Agent ? "agent" : profile.memberKind,
      metadata:
        profile.metadata && !Array.isArray(profile.metadata)
          ? Object.fromEntries(
              Object.entries(profile.metadata).map(([key, value]) => [
                key,
                typeof value === "object" && value !== null && "value" in value
                  ? (value as { readonly value: string | number | boolean })
                      .value
                  : value,
              ]),
            )
          : profile.metadata,
    }));
}

async function withFixedRandomValues<T>(
  seed: Uint8Array,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto);

  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    configurable: true,
    value<TArray extends ArrayBufferView | null>(array: TArray): TArray {
      if (array === null) {
        return array;
      }

      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      bytes.set(seed.slice(0, bytes.length));
      return array;
    },
  });

  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis.crypto, "getRandomValues", {
      configurable: true,
      value: original,
    });
  }
}

describe("Convos onboarding equivalence", () => {
  test("old and new invite generation stay byte-identical across core scenarios", async () => {
    const scheme = createConvosOnboardingScheme();
    const scenarios: readonly {
      readonly name: string;
      readonly input: GenerateInviteUrlOptions;
    }[] = [
      {
        name: "uuid conversation id",
        input: {
          conversationId: "550e8400-e29b-41d4-a716-446655440000",
          creatorInboxId: TEST_CREATOR_INBOX_ID,
          walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
          inviteTag: "uuid-tag",
          env: "production",
        },
      },
      {
        name: "string conversation id",
        input: {
          conversationId: "group:custom:onboarding-scheme",
          creatorInboxId: TEST_CREATOR_INBOX_ID,
          walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
          inviteTag: "string-tag",
          env: "dev",
          name: "String Format Group",
        },
      },
      {
        name: "compressed single-use expiring invite",
        input: {
          conversationId: "550e8400-e29b-41d4-a716-446655440000",
          creatorInboxId: TEST_CREATOR_INBOX_ID,
          walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
          inviteTag: "compressed-tag",
          env: "production",
          description: "B".repeat(500),
          expiresAt: new Date(Date.now() + 60_000),
          expiresAfterUse: true,
        },
      },
      {
        name: "expired invite flagging",
        input: {
          conversationId: "550e8400-e29b-41d4-a716-446655440000",
          creatorInboxId: TEST_CREATOR_INBOX_ID,
          walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
          inviteTag: "expired-tag",
          env: "production",
          expiresAt: new Date(Date.now() - 60_000),
        },
      },
    ];

    for (const scenario of scenarios) {
      const seed = new Uint8Array(12).fill(scenario.name.length);

      const oldUrl = await withFixedRandomValues(seed, async () =>
        generateConvosInviteUrl(scenario.input),
      );
      expect(oldUrl.isOk()).toBe(true);
      if (!oldUrl.isOk()) continue;

      const generated = await withFixedRandomValues(seed, async () =>
        scheme.generate(
          { groupId: scenario.input.conversationId },
          {
            creatorInboxId: scenario.input.creatorInboxId,
            walletPrivateKeyHex: scenario.input.walletPrivateKeyHex,
          },
          {
            tag: scenario.input.inviteTag,
            ...(scenario.input.name !== undefined
              ? { name: scenario.input.name }
              : {}),
            ...(scenario.input.description !== undefined
              ? { description: scenario.input.description }
              : {}),
            ...(scenario.input.imageUrl !== undefined
              ? { imageUrl: scenario.input.imageUrl }
              : {}),
          },
          {
            env: scenario.input.env ?? "production",
            ...(scenario.input.expiresAt !== undefined
              ? { expiresAt: scenario.input.expiresAt }
              : {}),
            ...(scenario.input.expiresAfterUse !== undefined
              ? { expiresAfterUse: scenario.input.expiresAfterUse }
              : {}),
          },
        ),
      );
      expect(generated.isOk()).toBe(true);
      if (!generated.isOk()) continue;

      expect(generated.value.url).toBe(oldUrl.value);
      expect(generated.value.slug).toBe(extractSlugFromUrl(oldUrl.value));

      const oldParsed = parseConvosInviteUrl(oldUrl.value);
      const newParsed = scheme.parse(generated.value.url);
      expect(oldParsed.isOk()).toBe(true);
      expect(newParsed.isOk()).toBe(true);
      if (!oldParsed.isOk() || !newParsed.isOk()) continue;

      expect(normalizeParsedInvite(newParsed.value)).toEqual({
        ...normalizeParsedInvite(oldParsed.value),
        schemeId: "convos",
      });

      expect(verifyConvosInvite(oldParsed.value).isOk()).toBe(true);
      expect(scheme.verify(newParsed.value).isOk()).toBe(true);
    }
  });

  test("old and new profile encoders produce identical bytes", () => {
    const scheme = createConvosOnboardingScheme();
    const metadata = {
      role: "assistant",
      retries: 3,
      enabled: true,
    } satisfies Record<string, string | number | boolean>;

    const oldUpdate = encodeProfileUpdate({
      name: "Signet Bot",
      memberKind: MemberKind.Agent,
      metadata: toConvosMetadata(metadata),
    } satisfies ProfileUpdateContent);
    const newUpdate = scheme.encodeProfileUpdate({
      name: "Signet Bot",
      memberKind: "agent",
      metadata,
    });

    expect(normalizeEncodedContent(newUpdate)).toEqual(
      normalizeEncodedContent(oldUpdate),
    );

    const oldSnapshot = encodeProfileSnapshot({
      profiles: [
        {
          inboxId: TEST_CREATOR_INBOX_ID,
          name: "Signet Bot",
          memberKind: MemberKind.Agent,
          metadata: toConvosMetadata(metadata),
        },
      ],
    } satisfies ProfileSnapshotContent);
    const newSnapshot = scheme.encodeProfileSnapshot([
      {
        inboxId: TEST_CREATOR_INBOX_ID,
        name: "Signet Bot",
        memberKind: "agent",
        metadata,
      },
    ]);

    expect(normalizeEncodedContent(newSnapshot)).toEqual(
      normalizeEncodedContent(oldSnapshot),
    );
  });

  test("old and new profile resolution produce the same logical view", () => {
    const scheme = createConvosOnboardingScheme();
    const metadata = {
      role: "assistant",
      retries: 1,
      enabled: true,
    } satisfies Record<string, string | number | boolean>;

    const messages: readonly XmtpDecodedMessage[] = [
      {
        messageId: "msg-2",
        groupId: "group-1",
        senderInboxId: TEST_CREATOR_INBOX_ID,
        contentType: "convos.org/profile_snapshot:1.0",
        content: encodeProfileSnapshot({
          profiles: [
            {
              inboxId: TEST_CREATOR_INBOX_ID,
              name: "Snapshot Name",
              memberKind: MemberKind.Agent,
              metadata: toConvosMetadata(metadata),
            } satisfies MemberProfileEntry,
          ],
        }),
        sentAt: "2026-04-17T00:00:02.000Z",
        threadId: null,
      },
      {
        messageId: "msg-1",
        groupId: "group-1",
        senderInboxId: TEST_CREATOR_INBOX_ID,
        contentType: "convos.org/profile_update:1.0",
        content: encodeProfileUpdate({
          name: "Update Name",
          memberKind: MemberKind.Agent,
          metadata: toConvosMetadata(metadata),
        }),
        sentAt: "2026-04-17T00:00:01.000Z",
        threadId: null,
      },
    ];

    const oldResolved = resolveProfilesFromMessages(messages, [
      TEST_CREATOR_INBOX_ID,
    ]);
    const newResolved = scheme.resolveProfilesFromHistory(messages, [
      TEST_CREATOR_INBOX_ID,
    ]);

    expect(normalizeProfiles(newResolved)).toEqual(
      normalizeProfiles(oldResolved),
    );
  });

  test("old and new host-side join processing return the same result", async () => {
    const scheme = createConvosOnboardingScheme();
    const groupId = "group:custom:onboarding-scheme";
    const inviteTag = "join-tag";
    const seed = new Uint8Array(12).fill(9);

    const oldUrl = await withFixedRandomValues(seed, async () =>
      generateConvosInviteUrl({
        conversationId: groupId,
        creatorInboxId: TEST_CREATOR_INBOX_ID,
        walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
        inviteTag,
        env: "production",
        expiresAfterUse: true,
      }),
    );
    expect(oldUrl.isOk()).toBe(true);
    if (!oldUrl.isOk()) return;

    const message = {
      senderInboxId: TEST_JOINER_INBOX_ID,
      content: { inviteSlug: extractSlugFromUrl(oldUrl.value) },
    };

    const oldAdds: Array<{ groupId: string; inboxIds: readonly string[] }> = [];
    const newAdds: Array<{ groupId: string; inboxIds: readonly string[] }> = [];

    const oldResult = await processJoinRequest(
      {
        walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
        creatorInboxId: TEST_CREATOR_INBOX_ID,
        addMembersToGroup: async (targetGroupId, inboxIds) => {
          oldAdds.push({ groupId: targetGroupId, inboxIds });
          return Result.ok(undefined);
        },
        getGroupInviteTag: async () => Result.ok(inviteTag),
      },
      message,
    );

    const newResult = await scheme.processJoinRequest(
      {
        walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
        creatorInboxId: TEST_CREATOR_INBOX_ID,
        addMembersToGroup: async (targetGroupId, inboxIds) => {
          newAdds.push({ groupId: targetGroupId, inboxIds });
          return Result.ok(undefined);
        },
        getGroupInviteTag: async () => Result.ok(inviteTag),
      },
      message,
    );

    expect(oldResult.isOk()).toBe(true);
    expect(newResult.isOk()).toBe(true);
    if (!oldResult.isOk() || !newResult.isOk()) return;

    expect(newResult.value).toEqual({
      groupId: oldResult.value.groupId,
      requesterInboxId: oldResult.value.requesterInboxId,
      inviteTag: oldResult.value.inviteTag,
    });
    expect(newAdds).toEqual(oldAdds);
  });
});
