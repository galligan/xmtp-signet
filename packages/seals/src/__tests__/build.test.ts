import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { buildSeal } from "../build.js";
import { validInput } from "./fixtures.js";

describe("buildSeal", () => {
  test("builds seal from valid input with no previous payload", () => {
    const result = buildSeal(validInput());
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.previous).toBeUndefined();
  });

  test("generates seal ID with seal_ prefix", () => {
    const result = buildSeal(validInput());
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.sealId).toMatch(/^seal_[0-9a-f]{16}$/);
  });

  test("chains to previous payload when provided", () => {
    const first = buildSeal(validInput());
    expect(Result.isOk(first)).toBe(true);
    if (Result.isError(first)) return;

    const result = buildSeal(validInput(), first.value.chain.current);
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.previous).toBeDefined();
    expect(result.value.chain.previous?.sealId).toBe(
      first.value.chain.current.sealId,
    );
  });

  test("sets issuedAt to current time", () => {
    const before = new Date();
    const result = buildSeal(validInput());
    const after = new Date();
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    const issuedAt = new Date(result.value.chain.current.issuedAt);
    expect(issuedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(issuedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("maps credentialId from input", () => {
    const result = buildSeal(validInput({ credentialId: "cred_feed1234feedbabe" }));
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.credentialId).toBe("cred_feed1234feedbabe");
  });

  test("maps operatorId from input", () => {
    const result = buildSeal(validInput({ operatorId: "op_feed1234feedbabe" }));
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.operatorId).toBe("op_feed1234feedbabe");
  });

  test("maps chatId from input", () => {
    const result = buildSeal(validInput({ chatId: "conv_feed1234feedbabe" }));
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.chatId).toBe("conv_feed1234feedbabe");
  });

  test("maps permissions from input", () => {
    const result = buildSeal(
      validInput({
        permissions: {
          allow: ["send", "reply", "react"],
          deny: ["forward-to-provider"],
        },
      }),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.permissions.allow).toEqual([
      "send",
      "reply",
      "react",
    ]);
    expect(result.value.chain.current.permissions.deny).toEqual([
      "forward-to-provider",
    ]);
  });

  test("maps scopeMode from input", () => {
    const result = buildSeal(validInput({ scopeMode: "shared" }));
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.scopeMode).toBe("shared");
  });

  test("maps adminAccess from input", () => {
    const result = buildSeal(
      validInput({
        adminAccess: {
          operatorId: "op_adcd0123feedbabe",
          expiresAt: "2025-12-31T23:59:59.000Z",
        },
      }),
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.current.adminAccess?.operatorId).toBe(
      "op_adcd0123feedbabe",
    );
  });

  test("produces serialized bytes of the seal chain", () => {
    const result = buildSeal(validInput());
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.serialized).toBeInstanceOf(Uint8Array);
    expect(result.value.serialized.length).toBeGreaterThan(0);
  });

  test("computes empty delta for first seal", () => {
    const result = buildSeal(validInput());
    expect(Result.isOk(result)).toBe(true);
    if (Result.isError(result)) return;
    expect(result.value.chain.delta).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });

  test("computes delta when permissions change", () => {
    const first = buildSeal(
      validInput({
        permissions: { allow: ["send", "reply"], deny: [] },
      }),
    );
    expect(Result.isOk(first)).toBe(true);
    if (Result.isError(first)) return;

    const second = buildSeal(
      validInput({
        permissions: { allow: ["send", "reply", "react"], deny: [] },
      }),
      first.value.chain.current,
    );
    expect(Result.isOk(second)).toBe(true);
    if (Result.isError(second)) return;
    expect(second.value.chain.delta.added).toContain("react");
  });

  test("tracks deny toggles when a scope remains listed in allow", () => {
    const first = buildSeal(
      validInput({
        permissions: { allow: ["send"], deny: [] },
      }),
    );
    expect(Result.isOk(first)).toBe(true);
    if (Result.isError(first)) return;

    const second = buildSeal(
      validInput({
        permissions: { allow: ["send"], deny: ["send"] },
      }),
      first.value.chain.current,
    );
    expect(Result.isOk(second)).toBe(true);
    if (Result.isError(second)) return;
    expect(second.value.chain.delta.changed).toContainEqual({
      scope: "send",
      from: "allow",
      to: "deny",
    });
  });

  test("tracks deny removal when a scope remains listed in allow", () => {
    const first = buildSeal(
      validInput({
        permissions: { allow: ["send"], deny: ["send"] },
      }),
    );
    expect(Result.isOk(first)).toBe(true);
    if (Result.isError(first)) return;

    const second = buildSeal(
      validInput({
        permissions: { allow: ["send"], deny: [] },
      }),
      first.value.chain.current,
    );
    expect(Result.isOk(second)).toBe(true);
    if (Result.isError(second)) return;
    expect(second.value.chain.delta.changed).toContainEqual({
      scope: "send",
      from: "deny",
      to: "allow",
    });
  });
});
