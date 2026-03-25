import { describe, expect, it } from "bun:test";
import { Ok } from "better-result";
import { z } from "zod";
import type { SignetError } from "@xmtp/signet-schemas";
import { createActionRegistry } from "../action-registry.js";
import type { ActionSpec, CliSurface, McpSurface } from "../action-spec.js";
import type { HandlerContext } from "../handler-types.js";

/** Minimal CLI surface for testing. */
const testCliSurface: CliSurface = {
  command: "test:run",
  description: "A test command",
};

/** Minimal MCP surface for testing. */
const testMcpSurface: McpSurface = {
  toolName: "signet/test/run",
  description: "A test tool",
  readOnly: true,
};

/** Create a minimal ActionSpec for testing. */
function createTestSpec(
  id: string,
  surfaces?: { cli?: CliSurface; mcp?: McpSurface },
): ActionSpec<unknown, unknown, SignetError> {
  return {
    id,
    handler: (_input: unknown, _ctx: HandlerContext) =>
      Promise.resolve(new Ok(null)),
    input: z.object({}),
    ...surfaces,
  };
}

describe("ActionRegistry", () => {
  it("registers and looks up a spec by id", () => {
    const registry = createActionRegistry();
    const spec = createTestSpec("credential.list");
    registry.register(spec);

    expect(registry.lookup("credential.list")).toBe(spec);
  });

  it("throws on duplicate registration", () => {
    const registry = createActionRegistry();
    const spec = createTestSpec("credential.list");
    registry.register(spec);

    expect(() => registry.register(spec)).toThrow(
      "Action 'credential.list' is already registered",
    );
  });

  it("returns undefined for unknown id", () => {
    const registry = createActionRegistry();
    expect(registry.lookup("nonexistent")).toBeUndefined();
  });

  it("lists all registered specs", () => {
    const registry = createActionRegistry();
    const spec1 = createTestSpec("credential.list");
    const spec2 = createTestSpec("credential.revoke");
    registry.register(spec1);
    registry.register(spec2);

    const all = registry.list();
    expect(all).toHaveLength(2);
    expect(all).toContain(spec1);
    expect(all).toContain(spec2);
  });

  it("filters by mcp surface", () => {
    const registry = createActionRegistry();
    const cliOnly = createTestSpec("signet.stop", {
      cli: testCliSurface,
    });
    const mcpOnly = createTestSpec("message.list", {
      mcp: testMcpSurface,
    });
    const both = createTestSpec("credential.list", {
      cli: testCliSurface,
      mcp: testMcpSurface,
    });
    registry.register(cliOnly);
    registry.register(mcpOnly);
    registry.register(both);

    const mcpSpecs = registry.listForSurface("mcp");
    expect(mcpSpecs).toHaveLength(2);
    expect(mcpSpecs).toContain(mcpOnly);
    expect(mcpSpecs).toContain(both);
  });

  it("filters by cli surface", () => {
    const registry = createActionRegistry();
    const cliOnly = createTestSpec("signet.stop", {
      cli: testCliSurface,
    });
    const mcpOnly = createTestSpec("message.list", {
      mcp: testMcpSurface,
    });
    const both = createTestSpec("credential.list", {
      cli: testCliSurface,
      mcp: testMcpSurface,
    });
    registry.register(cliOnly);
    registry.register(mcpOnly);
    registry.register(both);

    const cliSpecs = registry.listForSurface("cli");
    expect(cliSpecs).toHaveLength(2);
    expect(cliSpecs).toContain(cliOnly);
    expect(cliSpecs).toContain(both);
  });

  it("spec with both surfaces appears in both filtered lists", () => {
    const registry = createActionRegistry();
    const both = createTestSpec("credential.list", {
      cli: testCliSurface,
      mcp: testMcpSurface,
    });
    registry.register(both);

    expect(registry.listForSurface("cli")).toContain(both);
    expect(registry.listForSurface("mcp")).toContain(both);
  });

  it("reflects count via size", () => {
    const registry = createActionRegistry();
    expect(registry.size).toBe(0);

    registry.register(createTestSpec("a.one"));
    expect(registry.size).toBe(1);

    registry.register(createTestSpec("a.two"));
    expect(registry.size).toBe(2);
  });
});
