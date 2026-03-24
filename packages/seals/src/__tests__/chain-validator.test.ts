import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import type { SealChainType, SealPayloadType } from "@xmtp/signet-schemas";
import { buildSeal } from "../build.js";
import { validateSealChain, verifyChainDelta } from "../chain-validator.js";
import { validInput } from "./fixtures.js";

/** Helper: build a payload from input, returning just the chain. */
function buildChain(
  overrides?: Parameters<typeof validInput>[0],
  previous?: SealPayloadType,
): SealChainType {
  const result = buildSeal(validInput(overrides), previous);
  if (Result.isError(result)) {
    throw new Error(`buildSeal failed: ${result.error.message}`);
  }
  return result.value.chain;
}

describe("validateSealChain", () => {
  test("passes for chain with no previous", () => {
    const chain = buildChain();
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(true);
  });

  test("passes for valid chain with previous", () => {
    const first = buildChain();
    const chain = buildChain(undefined, first.current);
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(true);
  });

  test("fails when operator differs from previous", () => {
    const first = buildChain({ operatorId: "op_aaaaaaaafeedbabe" });
    // Manually construct chain with mismatched operator
    const second = buildChain({ operatorId: "op_bbbbbbbbfeedbabe" });
    const chain: SealChainType = {
      current: second.current,
      previous: first.current,
      delta: second.delta,
    };
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) return;
    expect(result.error.message).toMatch(/operator/i);
  });

  test("fails when chatId differs from previous", () => {
    const first = buildChain({ chatId: "conv_aaaaaaaafeedbabe" });
    const second = buildChain({ chatId: "conv_bbbbbbbbfeedbabe" });
    const chain: SealChainType = {
      current: second.current,
      previous: first.current,
      delta: second.delta,
    };
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) return;
    expect(result.error.message).toMatch(/chat/i);
  });

  test("fails when credential differs from previous", () => {
    const first = buildChain({ credentialId: "cred_aaaaaaaafeedbabe" });
    const second = buildChain({ credentialId: "cred_bbbbbbbbfeedbabe" });
    const chain: SealChainType = {
      current: second.current,
      previous: first.current,
      delta: second.delta,
    };
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) return;
    expect(result.error.message).toMatch(/credential/i);
  });

  test("fails when issuedAt is before previous issuedAt", () => {
    const first = buildChain();
    // Construct chain where current issuedAt is before previous
    const futurePayload: SealPayloadType = {
      ...first.current,
      issuedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const second = buildChain();
    const chain: SealChainType = {
      current: second.current,
      previous: futurePayload,
      delta: second.delta,
    };
    const result = validateSealChain(chain);
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) return;
    expect(result.error.message).toMatch(/issuedAt/i);
  });
});

describe("verifyChainDelta", () => {
  test("passes when delta matches actual difference", () => {
    const first = buildChain({
      permissions: { allow: ["send", "reply"], deny: [] },
    });
    const chain = buildChain(
      { permissions: { allow: ["send", "reply", "react"], deny: [] } },
      first.current,
    );
    const result = verifyChainDelta(chain);
    expect(Result.isOk(result)).toBe(true);
  });

  test("passes for first seal with empty delta", () => {
    const chain = buildChain();
    const result = verifyChainDelta(chain);
    expect(Result.isOk(result)).toBe(true);
  });

  test("fails when stored delta does not match recomputed delta", () => {
    const first = buildChain({
      permissions: { allow: ["send", "reply"], deny: [] },
    });
    const chain = buildChain(
      { permissions: { allow: ["send", "reply", "react"], deny: [] } },
      first.current,
    );
    // Tamper with the delta
    const tampered: SealChainType = {
      ...chain,
      delta: { added: [], removed: [], changed: [] },
    };
    const result = verifyChainDelta(tampered);
    expect(Result.isOk(result)).toBe(false);
    if (Result.isOk(result)) return;
    expect(result.error.message).toMatch(/delta/i);
  });
});
