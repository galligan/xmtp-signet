import { describe, expect, test } from "bun:test";
import { createSchemaComplianceCheck } from "../checks/schema-compliance.js";
import { createTestVerificationRequest, createTestSeal } from "./fixtures.js";

describe("schema_compliance check", () => {
  test("skips when no seal provided", async () => {
    const check = createSchemaComplianceCheck();
    const result = await check.execute(
      createTestVerificationRequest({ seal: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("schema_compliance");
    }
  });

  test("passes when seal is schema-compliant", async () => {
    const check = createSchemaComplianceCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("conforms");
    }
  });

  test("fails when seal has invalid fields", async () => {
    const check = createSchemaComplianceCheck();
    const badSeal = {
      ...createTestSeal(),
      viewMode: "invalid-mode",
    };

    const result = await check.execute(
      createTestVerificationRequest({
        // Force the bad seal through by bypassing the schema.
        seal: badSeal as ReturnType<typeof createTestSeal>,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("validation failed");
    }
  });
});
