import { describe, expect, test } from "bun:test";
import { VerificationRequestSchema } from "../schemas/request.js";
import { createTestVerificationRequest } from "./fixtures.js";

describe("VerificationRequestSchema", () => {
  test("accepts a valid request with seal", () => {
    const request = createTestVerificationRequest();
    const result = VerificationRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  test("accepts a valid request with null optional fields", () => {
    const request = createTestVerificationRequest({
      seal: null,
      groupId: null,
      buildProvenanceBundle: null,
      releaseTag: null,
    });
    const result = VerificationRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  test("rejects request missing requestId", () => {
    const { requestId: _, ...rest } = createTestVerificationRequest();
    const result = VerificationRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  test("rejects request with invalid sourceRepoUrl", () => {
    const request = createTestVerificationRequest({
      sourceRepoUrl: "not-a-url",
    });
    const result = VerificationRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  test("rejects request with invalid requestedTier", () => {
    const request = {
      ...createTestVerificationRequest(),
      requestedTier: "invalid-tier",
    };
    const result = VerificationRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  test("rejects request missing challengeNonce", () => {
    const { challengeNonce: _, ...rest } = createTestVerificationRequest();
    const result = VerificationRequestSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
