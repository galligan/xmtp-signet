import { describe, test, expect } from "bun:test";
import {
  validateCredential,
  checkCredentialLiveness,
} from "../credential-guard.js";
import {
  makeCredentialRecord,
  createMockCredentialLookups,
} from "./fixtures.js";

describe("validateCredential", () => {
  test("valid token resolves to credential record", async () => {
    const record = makeCredentialRecord();
    const { tokenLookup } = createMockCredentialLookups("valid_token", record);

    const result = await validateCredential("valid_token", tokenLookup);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.credentialId).toBe("cred_aabbccddeeff0011");
    }
  });

  test("invalid token returns auth error", async () => {
    const { tokenLookup } = createMockCredentialLookups("valid_token");

    const result = await validateCredential("bad_token", tokenLookup);

    expect(result.isOk()).toBe(false);
    if (!result.isOk()) {
      expect(result.error.category).toBe("auth");
    }
  });
});

describe("checkCredentialLiveness", () => {
  test("active non-expired credential passes", async () => {
    const record = makeCredentialRecord({
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active",
    });
    const { credentialLookup } = createMockCredentialLookups(
      "valid_token",
      record,
    );

    const result = await checkCredentialLiveness(record, credentialLookup);

    expect(result.isOk()).toBe(true);
  });

  test("expired credential returns auth error", async () => {
    const record = makeCredentialRecord({
      expiresAt: "2020-01-01T00:00:00Z",
      status: "active",
    });
    const { credentialLookup } = createMockCredentialLookups(
      "valid_token",
      record,
    );

    const result = await checkCredentialLiveness(record, credentialLookup);

    expect(result.isOk()).toBe(false);
    if (!result.isOk()) {
      expect(result.error.category).toBe("auth");
    }
  });

  test("revoked credential returns auth error", async () => {
    const record = makeCredentialRecord({
      expiresAt: "2099-01-01T00:00:00Z",
      status: "revoked",
    });
    const { credentialLookup } = createMockCredentialLookups(
      "valid_token",
      record,
    );

    const result = await checkCredentialLiveness(record, credentialLookup);

    expect(result.isOk()).toBe(false);
    if (!result.isOk()) {
      expect(result.error.category).toBe("auth");
    }
  });

  test("credential check re-fetches from lookup", async () => {
    const record = makeCredentialRecord();
    const { credentialLookup } = createMockCredentialLookups(
      "valid_token",
      record,
    );

    const result = await checkCredentialLiveness(record, credentialLookup);

    expect(result.isOk()).toBe(true);
  });

  test("uses the refreshed credential expiry after renewal", async () => {
    const cached = makeCredentialRecord({
      expiresAt: "2020-01-01T00:00:00Z",
      status: "active",
    });
    const renewed = makeCredentialRecord({
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active",
    });
    const { credentialLookup, _state } = createMockCredentialLookups(
      "valid_token",
      cached,
    );
    _state.credentials.set(cached.credentialId, renewed);

    const result = await checkCredentialLiveness(cached, credentialLookup);

    expect(result.isOk()).toBe(true);
  });
});
