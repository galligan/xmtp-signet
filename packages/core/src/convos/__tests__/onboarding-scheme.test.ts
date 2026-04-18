import { describe, expect, test } from "bun:test";
import { createConvosOnboardingScheme } from "../onboarding-scheme.js";

const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";

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

describe("createConvosOnboardingScheme", () => {
  test("roundtrips a generated invite through parse and verify", async () => {
    const scheme = createConvosOnboardingScheme();

    const generated = await scheme.generate(
      { groupId: TEST_CONVERSATION_ID, format: "uuid" },
      {
        creatorInboxId: TEST_CREATOR_INBOX_ID,
        walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
      },
      {
        tag: "scheme-test-tag",
        name: "Scheme Test",
      },
      { env: "production" },
    );

    expect(generated.isOk()).toBe(true);
    if (!generated.isOk()) return;

    const parsed = scheme.parse(generated.value.url);
    expect(parsed.isOk()).toBe(true);
    if (!parsed.isOk()) return;

    expect(parsed.value.schemeId).toBe("convos");
    expect(parsed.value.tag).toBe("scheme-test-tag");

    const verified = scheme.verify(parsed.value);
    expect(verified.isOk()).toBe(true);
  });

  test("surfaces canonical content-type labels", () => {
    const scheme = createConvosOnboardingScheme();

    expect(scheme.joinRequestContentType()).toBe("convos.org/join_request:1.0");
    expect(scheme.profileUpdateContentType()).toBe(
      "convos.org/profile_update:1.0",
    );
    expect(scheme.profileSnapshotContentType()).toBe(
      "convos.org/profile_snapshot:1.0",
    );
    expect(scheme.errorContentType()).toBe("convos.app/inviteJoinError:1.0");
  });

  test("honors the conversation format hint for UUID-shaped ids", async () => {
    await withFixedRandomValues(
      Uint8Array.from({ length: 12 }, (_, i) => i),
      async () => {
        const scheme = createConvosOnboardingScheme();
        const creator = {
          creatorInboxId: TEST_CREATOR_INBOX_ID,
          walletPrivateKeyHex: TEST_PRIVATE_KEY_HEX,
        };
        const metadata = { tag: "format-hint" };
        const options = { env: "production" as const };

        const uuidEncoded = await scheme.generate(
          { groupId: TEST_CONVERSATION_ID, format: "uuid" },
          creator,
          metadata,
          options,
        );
        const stringEncoded = await scheme.generate(
          { groupId: TEST_CONVERSATION_ID, format: "string" },
          creator,
          metadata,
          options,
        );

        expect(uuidEncoded.isOk()).toBe(true);
        expect(stringEncoded.isOk()).toBe(true);
        if (!uuidEncoded.isOk() || !stringEncoded.isOk()) return;

        expect(uuidEncoded.value.slug).not.toBe(stringEncoded.value.slug);
      },
    );
  });

  test("rejects plain image URLs when encoding a profile update", () => {
    const scheme = createConvosOnboardingScheme();

    expect(() =>
      scheme.encodeProfileUpdate({
        name: "Codex",
        imageUrl: "https://example.com/avatar.png",
      }),
    ).toThrow("imageUrl");
  });

  test("rejects plain image URLs when encoding a profile snapshot", () => {
    const scheme = createConvosOnboardingScheme();

    expect(() =>
      scheme.encodeProfileSnapshot([
        {
          inboxId: "inbox-a",
          name: "Codex",
          imageUrl: "https://example.com/avatar.png",
        },
      ]),
    ).toThrow("imageUrl");
  });

  test("surfaces encrypted image URLs when resolving profile history", () => {
    const scheme = createConvosOnboardingScheme();

    const resolved = scheme.resolveProfilesFromHistory([
      {
        messageId: "msg-1",
        groupId: "group-1",
        senderInboxId: "inbox-a",
        contentType: scheme.profileUpdateContentType(),
        content: {
          name: "Codex",
          encryptedImage: {
            url: "https://example.com/avatar.png",
            salt: new Uint8Array([1, 2, 3]),
            nonce: new Uint8Array([4, 5, 6]),
          },
        },
        sentAt: "2026-04-18T03:00:00.000Z",
        threadId: null,
      },
    ]);

    expect(resolved.get("inbox-a")).toEqual({
      inboxId: "inbox-a",
      name: "Codex",
      imageUrl: "https://example.com/avatar.png",
    });
  });
});
