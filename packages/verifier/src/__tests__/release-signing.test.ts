import { describe, expect, test } from "bun:test";
import { createReleaseSigningCheck } from "../checks/release-signing.js";
import { createTestVerificationRequest } from "./fixtures.js";

describe("release_signing check", () => {
  test("skips when no release tag provided", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({ releaseTag: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("release_signing");
    }
  });

  test("skips with v0 stub message when tag provided", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({ releaseTag: "v0.1.0" }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("v0 stub");
    }
  });

  test("includes release tag and repo url in evidence", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({ releaseTag: "v1.0.0" }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const evidence = result.value.evidence as Record<string, unknown>;
      expect(evidence["releaseTag"]).toBe("v1.0.0");
      expect(evidence["sourceRepoUrl"]).toBe(
        "https://github.com/xmtp/xmtp-broker",
      );
    }
  });
});
