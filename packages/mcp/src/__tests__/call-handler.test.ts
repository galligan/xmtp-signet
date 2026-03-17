import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { PermissionError } from "@xmtp/signet-schemas";
import { handleCallTool } from "../call-handler.js";
import {
  createSendSpec,
  createTestRegistry,
  makeSessionRecord,
  createMockSignerProvider,
} from "./fixtures.js";

function makeCallContext() {
  return {
    signetId: "signet_1",
    signerProvider: createMockSignerProvider(),
    sessionRecord: makeSessionRecord(),
    requestTimeoutMs: 30_000,
  };
}

describe("handleCallTool", () => {
  test("valid request routes to handler and returns success", async () => {
    const registry = createTestRegistry();
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/message/send",
        arguments: {
          conversationId: "conv_1",
          content: { text: "hello" },
        },
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    expect(parsed.ok).toBe(true);
    expect(parsed.data.messageId).toBe("msg_1");
  });

  test("invalid input returns validation error with isError true", async () => {
    const registry = createTestRegistry();
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/message/send",
        arguments: {
          // missing required conversationId
          content: { text: "hello" },
        },
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("validation");
  });

  test("handler success wrapped in MCP content", async () => {
    const registry = createTestRegistry();
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/message/list",
        arguments: { conversationId: "conv_1" },
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
  });

  test("handler error wrapped in MCP content with isError true", async () => {
    const failSpec = createSendSpec(async () =>
      Result.err(PermissionError.create("Not allowed", { action: "send" })),
    );
    const registry = createTestRegistry([failSpec]);
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/message/send",
        arguments: {
          conversationId: "conv_1",
          content: { text: "hello" },
        },
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("permission");
  });

  test("unknown tool returns error", async () => {
    const registry = createTestRegistry();
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/nonexistent/tool",
        arguments: {},
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("not_found");
  });

  test("handler throw caught and wrapped as internal error", async () => {
    const throwSpec = createSendSpec(async () => {
      throw new Error("Unexpected crash");
    });
    const registry = createTestRegistry([throwSpec]);
    const ctx = makeCallContext();

    const result = await handleCallTool(
      {
        name: "signet/message/send",
        arguments: {
          conversationId: "conv_1",
          content: { text: "hello" },
        },
      },
      registry,
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "");
    expect(parsed.ok).toBe(false);
    expect(parsed.error.category).toBe("internal");
  });
});
