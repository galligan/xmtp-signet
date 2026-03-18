import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createReleaseSigningCheck } from "../checks/release-signing.js";
import { createTestVerificationRequest } from "./fixtures.js";

describe("release_signing check", () => {
  // Save original fetch for restoration
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
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

  test("skips for non-GitHub source URLs", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v1.0.0",
        sourceRepoUrl: "https://gitlab.com/org/repo",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("not a GitHub URL");
    }
  });

  test("fails when release tag does not exist on GitHub", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v99.99.99-nonexistent",
        sourceRepoUrl: "https://github.com/xmtp/xmtp-signet",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // Either fail (404) or skip (network issue)
      expect(["fail", "skip"]).toContain(result.value.verdict);
      if (result.value.verdict === "fail") {
        expect(result.value.reason).toContain("No GitHub release found");
      }
    }
  });

  test("includes release tag in evidence", async () => {
    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v1.0.0",
        sourceRepoUrl: "https://github.com/xmtp/xmtp-signet",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const evidence = result.value.evidence as Record<string, unknown>;
      // Evidence should contain the tag regardless of verdict
      expect(evidence).not.toBeNull();
      if (evidence !== null) {
        expect(evidence["releaseTag"]).toBeDefined();
      }
    }
  });

  test("fails when release has signing assets but none match the artifact digest", async () => {
    // Mock fetch to return a release with signing assets for a DIFFERENT digest
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: "v1.0.0",
          draft: false,
          prerelease: false,
          html_url: "https://github.com/test/repo/releases/tag/v1.0.0",
          assets: [
            { name: "other-artifact-aabbccdd.sig" },
            { name: "other-artifact-aabbccdd.sigstore.json" },
            { name: "checksums.txt" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v1.0.0",
        sourceRepoUrl: "https://github.com/test/repo",
        // This digest doesn't match any asset filename
        artifactDigest:
          "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("no signing artifacts");
    }
  });

  test("passes when release has signing assets matching the artifact digest", async () => {
    const digest =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag_name: "v1.0.0",
          draft: false,
          prerelease: false,
          html_url: "https://github.com/test/repo/releases/tag/v1.0.0",
          assets: [
            { name: `signet-v1.0.0-${digest.slice(0, 12)}.sig` },
            { name: "unrelated-asset.zip" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v1.0.0",
        sourceRepoUrl: "https://github.com/test/repo",
        artifactDigest: digest,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("signing artifact");
    }
  });

  test("skips when fetch times out or network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network timeout");
    }) as typeof fetch;

    const check = createReleaseSigningCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        releaseTag: "v1.0.0",
        sourceRepoUrl: "https://github.com/test/repo",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.reason).toContain("timeout or network error");
    }
  });
});
