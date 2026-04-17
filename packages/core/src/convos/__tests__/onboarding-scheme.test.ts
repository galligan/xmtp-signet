import { describe, expect, test } from "bun:test";
import { createConvosOnboardingScheme } from "../onboarding-scheme.js";

const TEST_PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const TEST_CREATOR_INBOX_ID =
  "aabbccddee1122334455667788990011aabbccddee1122334455667788990011";

const TEST_CONVERSATION_ID = "550e8400-e29b-41d4-a716-446655440000";

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
});
