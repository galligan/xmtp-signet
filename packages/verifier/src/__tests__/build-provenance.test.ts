import { describe, expect, test } from "bun:test";
import { createBuildProvenanceCheck } from "../checks/build-provenance.js";
import { createTestVerificationRequest } from "./fixtures.js";

describe("build_provenance check", () => {
  test("skips when no bundle provided", async () => {
    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({ buildProvenanceBundle: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("build_provenance");
    }
  });

  test("fails with v0 stub message when valid base64 JSON provided", async () => {
    const check = createBuildProvenanceCheck();
    const bundle = btoa(JSON.stringify({ type: "slsa-provenance" }));
    const result = await check.execute(
      createTestVerificationRequest({ buildProvenanceBundle: bundle }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("v0 stub");
    }
  });

  test("fails when bundle is not valid base64", async () => {
    const check = createBuildProvenanceCheck();
    const result = await check.execute(
      createTestVerificationRequest({
        buildProvenanceBundle: "!!!not-base64!!!",
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("not valid base64");
    }
  });
});
