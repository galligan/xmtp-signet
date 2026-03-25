import { describe, expect, test } from "bun:test";
import { generateToken, generateCredentialId } from "../token.js";

describe("generateToken", () => {
  test("returns a base64url-encoded string of 43 characters", () => {
    const token = generateToken();
    expect(token).toHaveLength(43);
  });

  test("contains only base64url-safe characters", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("generates unique tokens on each call", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });

  test("can be decoded back to 32 bytes", () => {
    const token = generateToken();
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(padded, "base64");
    expect(decoded).toHaveLength(32);
  });
});

describe("generateCredentialId", () => {
  test("starts with cred_ prefix", () => {
    const id = generateCredentialId();
    expect(id.startsWith("cred_")).toBe(true);
  });

  test("has correct format (cred_ + 16 hex chars)", () => {
    const id = generateCredentialId();
    expect(id).toMatch(/^cred_[0-9a-f]{16}$/);
  });

  test("generates unique IDs on each call", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => generateCredentialId()),
    );
    expect(ids.size).toBe(100);
  });
});
