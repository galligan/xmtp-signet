import { describe, expect, test } from "bun:test";
import { createSdkClient } from "../sdk/sdk-client.js";
import type { SdkDecodedMessageShape } from "../sdk/sdk-types.js";
import {
  createMockSdkNativeClient,
  createMockGroup,
  createMockDecodedMessage,
} from "./sdk-fixtures.js";

describe("listMessages", () => {
  test("returns messages with no options", async () => {
    const msgs = [
      createMockDecodedMessage({ id: "m1" }),
      createMockDecodedMessage({ id: "m2" }),
    ];
    const group = createMockGroup({ id: "g1" });
    group.messages = async () => msgs;
    const native = createMockSdkNativeClient({ groups: [group] });
    const client = createSdkClient({
      client: native,
      syncTimeoutMs: 5000,
    });

    const result = await client.listMessages("g1");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.messageId).toBe("m1");
      expect(result.value[1]!.messageId).toBe("m2");
    }
  });

  test("passes limit as plain number", async () => {
    let captured: Record<string, unknown> | undefined;
    const group = createMockGroup({ id: "g1" });
    group.messages = async (
      opts?: Record<string, unknown>,
    ): Promise<SdkDecodedMessageShape[]> => {
      captured = opts;
      return [];
    };
    const native = createMockSdkNativeClient({ groups: [group] });
    const client = createSdkClient({
      client: native,
      syncTimeoutMs: 5000,
    });

    await client.listMessages("g1", { limit: 10 });
    expect(captured).toBeDefined();
    expect(captured!["limit"]).toBe(10);
  });

  test("converts before/after to nanoseconds", async () => {
    let captured: Record<string, unknown> | undefined;
    const group = createMockGroup({ id: "g1" });
    group.messages = async (
      opts?: Record<string, unknown>,
    ): Promise<SdkDecodedMessageShape[]> => {
      captured = opts;
      return [];
    };
    const native = createMockSdkNativeClient({ groups: [group] });
    const client = createSdkClient({
      client: native,
      syncTimeoutMs: 5000,
    });

    const before = "2025-01-15T12:00:00.000Z";
    const after = "2025-01-14T12:00:00.000Z";
    await client.listMessages("g1", { before, after });

    expect(captured).toBeDefined();
    const expectedBeforeNs = BigInt(new Date(before).getTime()) * 1_000_000n;
    const expectedAfterNs = BigInt(new Date(after).getTime()) * 1_000_000n;
    expect(captured!["sentBeforeNs"]).toBe(expectedBeforeNs);
    expect(captured!["sentAfterNs"]).toBe(expectedAfterNs);
  });

  test("maps direction strings to SDK enum values", async () => {
    let captured: Record<string, unknown> | undefined;
    const group = createMockGroup({ id: "g1" });
    group.messages = async (
      opts?: Record<string, unknown>,
    ): Promise<SdkDecodedMessageShape[]> => {
      captured = opts;
      return [];
    };
    const native = createMockSdkNativeClient({ groups: [group] });
    const client = createSdkClient({
      client: native,
      syncTimeoutMs: 5000,
    });

    await client.listMessages("g1", { direction: "ascending" });
    expect(captured).toBeDefined();
    expect(captured!["direction"]).toBe(1);

    await client.listMessages("g1", { direction: "descending" });
    expect(captured).toBeDefined();
    expect(captured!["direction"]).toBe(2);
  });

  test("returns NotFoundError for unknown group", async () => {
    const native = createMockSdkNativeClient({ groups: [] });
    const client = createSdkClient({
      client: native,
      syncTimeoutMs: 5000,
    });

    const result = await client.listMessages("nonexistent");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error._tag).toBe("NotFoundError");
    }
  });
});
