import { describe, test, expect } from "bun:test";
import { Result } from "better-result";
import { z } from "zod";
import {
  createActionRegistry,
  type ActionSpec,
  type HandlerContext,
} from "@xmtp/signet-contracts";
import { ValidationError, type SignetError } from "@xmtp/signet-schemas";
import { createAdminDispatcher } from "../admin/dispatcher.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeHandlerContext(
  overrides?: Partial<HandlerContext>,
): HandlerContext {
  return {
    signetId: "test-signet",
    signerProvider: {} as HandlerContext["signerProvider"],
    requestId: crypto.randomUUID(),
    signal: AbortSignal.timeout(5_000),
    ...overrides,
  };
}

function makeSpec(
  id: string,
  opts?: {
    rpcMethod?: string;
    command?: string;
    handler?: ActionSpec<unknown, unknown, SignetError>["handler"];
    input?: z.ZodType<unknown>;
  },
): ActionSpec<unknown, unknown, SignetError> {
  return {
    id,
    handler: opts?.handler ?? (async (input: unknown) => Result.ok(input)),
    input: opts?.input ?? z.object({}).passthrough(),
    cli: {
      command: opts?.command ?? id.replace(/\./g, ":"),
      rpcMethod: opts?.rpcMethod,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AdminDispatcher", () => {
  test("dispatches to correct handler via explicit rpcMethod", async () => {
    const registry = createActionRegistry();
    const spec = makeSpec("session.list", {
      rpcMethod: "session.list",
      command: "session:list",
      handler: async () => Result.ok({ sessions: [] }),
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    const result = await dispatcher.dispatch("session.list", {}, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ sessions: [] });
    }
  });

  test("derives rpcMethod from command by replacing : with .", async () => {
    const registry = createActionRegistry();
    // No explicit rpcMethod -- should derive "session.revoke" from "session:revoke"
    const spec = makeSpec("session.revoke", {
      command: "session:revoke",
      handler: async () => Result.ok({ revoked: true }),
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    const result = await dispatcher.dispatch("session.revoke", {}, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ revoked: true });
    }
  });

  test("returns error for unknown method", async () => {
    const registry = createActionRegistry();
    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    const result = await dispatcher.dispatch("nonexistent.method", {}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("not_found");
    }
  });

  test("returns validation error when input fails schema", async () => {
    const registry = createActionRegistry();
    const spec = makeSpec("session.issue", {
      rpcMethod: "session.issue",
      command: "session:issue",
      input: z.object({
        agentId: z.string().min(1),
      }),
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    // Missing required agentId
    const result = await dispatcher.dispatch("session.issue", {}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("validation");
    }
  });

  test("wraps handler error in ActionResult", async () => {
    const registry = createActionRegistry();
    const spec = makeSpec("key.rotate", {
      rpcMethod: "key.rotate",
      command: "key:rotate",
      handler: async () =>
        Result.err(ValidationError.create("keyId", "Key not found")),
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    const result = await dispatcher.dispatch("key.rotate", {}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("ValidationError");
    }
  });

  test("hasMethod returns true for registered method", () => {
    const registry = createActionRegistry();
    const spec = makeSpec("session.list", {
      rpcMethod: "session.list",
      command: "session:list",
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    expect(dispatcher.hasMethod("session.list")).toBe(true);
  });

  test("hasMethod returns false for unregistered method", () => {
    const registry = createActionRegistry();
    const dispatcher = createAdminDispatcher(registry);
    expect(dispatcher.hasMethod("unknown.method")).toBe(false);
  });

  test("handler that throws returns InternalError", async () => {
    const registry = createActionRegistry();
    const spec = makeSpec("boom.action", {
      rpcMethod: "boom.action",
      command: "boom:action",
      handler: async () => {
        throw new Error("unexpected kaboom");
      },
    });
    registry.register(spec);

    const dispatcher = createAdminDispatcher(registry);
    const ctx = makeHandlerContext();
    const result = await dispatcher.dispatch("boom.action", {}, ctx);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("InternalError");
      expect(result.error.message).toContain("unexpected kaboom");
    }
  });
});
