import { describe, expect, it } from "bun:test";
import {
  CredentialConfig,
  CredentialRecord,
  CredentialToken,
  IssuedCredential,
} from "../credential.js";
import { MessageSealBinding, SealEnvelope, SealPayload } from "../seal.js";
import {
  createTestCredentialConfig,
  createTestCredentialRecord,
  createTestCredentialToken,
  createTestIssuedCredential,
  createTestMessageSealBinding,
  createTestSealEnvelope,
  createTestSealPayload,
} from "./fixtures.js";

describe("test-utils fixtures", () => {
  it("produce valid credential fixtures", () => {
    expect(
      CredentialConfig.safeParse(createTestCredentialConfig()).success,
    ).toBe(true);
    expect(
      CredentialRecord.safeParse(createTestCredentialRecord()).success,
    ).toBe(true);
    expect(CredentialToken.safeParse(createTestCredentialToken()).success).toBe(
      true,
    );
    expect(
      IssuedCredential.safeParse(createTestIssuedCredential()).success,
    ).toBe(true);
  });

  it("produce valid seal fixtures", () => {
    expect(SealPayload.safeParse(createTestSealPayload()).success).toBe(true);
    expect(
      MessageSealBinding.safeParse(createTestMessageSealBinding()).success,
    ).toBe(true);
    expect(SealEnvelope.safeParse(createTestSealEnvelope()).success).toBe(true);
  });
});
