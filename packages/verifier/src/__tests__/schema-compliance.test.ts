import { describe, expect, test } from "bun:test";
import { createSchemaComplianceCheck } from "../checks/schema-compliance.js";
import {
  createTestVerificationRequest,
  createTestAttestation,
} from "./fixtures.js";

describe("schema_compliance check", () => {
  test("skips when no attestation provided", async () => {
    const check = createSchemaComplianceCheck();
    const result = await check.execute(
      createTestVerificationRequest({ attestation: null }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("skip");
      expect(result.value.checkId).toBe("schema_compliance");
    }
  });

  test("passes when attestation is schema-compliant", async () => {
    const check = createSchemaComplianceCheck();
    const result = await check.execute(createTestVerificationRequest());

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("pass");
      expect(result.value.reason).toContain("conforms");
    }
  });

  test("fails when attestation has invalid fields", async () => {
    const check = createSchemaComplianceCheck();
    // Create a request with a malformed attestation
    const badAttestation = {
      ...createTestAttestation(),
      viewMode: "invalid-mode",
    };

    const result = await check.execute(
      createTestVerificationRequest({
        // Force the bad attestation through by bypassing the schema
        attestation: badAttestation as ReturnType<typeof createTestAttestation>,
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.verdict).toBe("fail");
      expect(result.value.reason).toContain("validation failed");
    }
  });
});
