import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import type { SealEnvelopeType } from "@xmtp/signet-schemas";
import { NetworkError } from "@xmtp/signet-schemas";
import {
  republishToChats,
  type SealRepublisher,
  type AutoRepublishConfig,
} from "../auto-republish.js";

/** Minimal valid seal envelope for testing. */
function stubSeal(): SealEnvelopeType {
  return {
    chain: {
      current: {
        sealId: "seal_test0001",
        version: 1,
        credentialId: "cred_c001d00dfeedbabe",
        operatorId: "op_c001d00dfeedbabe",
        chatId: "chat_test0001",
        scopeMode: "per-chat",
        permissions: { allow: ["send"], deny: [] },
        issuedAt: new Date().toISOString(),
      },
      delta: { added: [], removed: [], changed: [] },
    },
    signature: "dGVzdA==",
    keyId: "key_feedc0defeedbabe",
    algorithm: "Ed25519",
  };
}

/** Creates a publisher that always succeeds and tracks calls. */
function succeedingPublisher(): SealRepublisher & {
  readonly calls: Array<{ chatId: string; seal: SealEnvelopeType }>;
} {
  const calls: Array<{ chatId: string; seal: SealEnvelopeType }> = [];
  const fn: SealRepublisher = async (chatId, seal) => {
    calls.push({ chatId, seal });
    return Result.ok();
  };
  return Object.assign(fn, { calls });
}

/** Creates a publisher that fails N times per chat, then succeeds. */
function failThenSucceedPublisher(
  failuresPerChat: Map<string, number>,
): SealRepublisher & {
  readonly callCounts: Map<string, number>;
} {
  const callCounts = new Map<string, number>();
  const fn: SealRepublisher = async (chatId, _seal) => {
    const count = (callCounts.get(chatId) ?? 0) + 1;
    callCounts.set(chatId, count);
    const maxFailures = failuresPerChat.get(chatId) ?? 0;
    if (count <= maxFailures) {
      return Result.err(
        NetworkError.create(chatId, `attempt ${String(count)} failed`),
      );
    }
    return Result.ok();
  };
  return Object.assign(fn, { callCounts });
}

/** Creates a publisher that always fails. */
function alwaysFailPublisher(): SealRepublisher & {
  readonly callCounts: Map<string, number>;
} {
  const callCounts = new Map<string, number>();
  const fn: SealRepublisher = async (chatId, _seal) => {
    const count = (callCounts.get(chatId) ?? 0) + 1;
    callCounts.set(chatId, count);
    return Result.err(
      NetworkError.create(chatId, `attempt ${String(count)} failed`),
    );
  };
  return Object.assign(fn, { callCounts });
}

describe("republishToChats", () => {
  test("matching chat succeeds on first attempt", async () => {
    const publisher = succeedingPublisher();
    const seal = stubSeal();
    const chatIds = [seal.chain.current.chatId];

    const result = await republishToChats(chatIds, seal, publisher);

    expect(result.succeeded).toEqual([seal.chain.current.chatId]);
    expect(result.failed).toEqual([]);
    expect(publisher.calls).toHaveLength(1);
  });

  test("retries a failing matching chat then succeeds", async () => {
    const seal = stubSeal();
    const failures = new Map([[seal.chain.current.chatId, 2]]);
    const publisher = failThenSucceedPublisher(failures);
    const chatIds = [seal.chain.current.chatId];

    const result = await republishToChats(chatIds, seal, publisher, {
      maxRetries: 3,
      initialDelayMs: 1,
    });

    expect(result.succeeded).toEqual([seal.chain.current.chatId]);
    expect(result.failed).toEqual([]);
    expect(publisher.callCounts.get(seal.chain.current.chatId)).toBe(3);
  });

  test("matching chat fails all retries and appears in failed list", async () => {
    const publisher = alwaysFailPublisher();
    const seal = stubSeal();
    const chatIds = [seal.chain.current.chatId];

    const result = await republishToChats(chatIds, seal, publisher, {
      maxRetries: 2,
      initialDelayMs: 1,
    });

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.chatId).toBe(seal.chain.current.chatId);
    expect(result.failed[0]?.error._tag).toBe("NetworkError");
    // 1 initial + 2 retries = 3 total calls
    expect(publisher.callCounts.get(seal.chain.current.chatId)).toBe(3);
  });

  test("empty chatIds returns empty results", async () => {
    const publisher = succeedingPublisher();
    const seal = stubSeal();

    const result = await republishToChats([], seal, publisher);

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(publisher.calls).toHaveLength(0);
  });

  test("fails fast when the target chat does not match the seal payload", async () => {
    const publisher = succeedingPublisher();
    const seal = stubSeal();

    const result = await republishToChats(["chat_other000"], seal, publisher);

    expect(result.succeeded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.chatId).toBe("chat_other000");
    expect(result.failed[0]?.error._tag).toBe("ValidationError");
    expect(publisher.calls).toHaveLength(0);
  });

  test("custom config overrides defaults", async () => {
    const publisher = alwaysFailPublisher();
    const seal = stubSeal();
    const config: AutoRepublishConfig = {
      maxRetries: 1,
      initialDelayMs: 1,
    };

    const result = await republishToChats(
      [seal.chain.current.chatId],
      seal,
      publisher,
      config,
    );

    // 1 initial + 1 retry = 2 total calls
    expect(publisher.callCounts.get(seal.chain.current.chatId)).toBe(2);
    expect(result.failed).toHaveLength(1);
  });

  test("mixed results succeed for matching chat and fail for mismatched chats", async () => {
    const publisher = succeedingPublisher();
    const seal = stubSeal();

    const result = await republishToChats(
      [seal.chain.current.chatId, "chat_fail"],
      seal,
      publisher,
      { maxRetries: 2, initialDelayMs: 1 },
    );

    expect(result.succeeded).toEqual([seal.chain.current.chatId]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.chatId).toBe("chat_fail");
    expect(result.failed[0]?.error._tag).toBe("ValidationError");
  });
});
