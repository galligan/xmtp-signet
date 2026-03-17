import { describe, test, expect } from "bun:test";
import { actionSpecToMcpTool } from "../tool-registration.js";
import {
  createSendSpec,
  createListSpec,
  createReadOnlySpec,
  createDestructiveSpec,
  createAdminOnlySpec,
  createTestRegistry,
} from "./fixtures.js";

describe("actionSpecToMcpTool", () => {
  test("converts ActionSpec with mcp metadata to MCP tool", () => {
    const spec = createSendSpec();
    const tool = actionSpecToMcpTool(spec);

    expect(tool).toBeDefined();
    expect(tool.name).toBe("signet/message/send");
    expect(tool.description).toBe("Send a message to a conversation");
  });

  test("uses toolName from McpSurface", () => {
    const spec = createListSpec();
    const tool = actionSpecToMcpTool(spec);

    expect(tool.name).toBe("signet/message/list");
  });

  test("converts input schema via zodToJsonSchema", () => {
    const spec = createSendSpec();
    const tool = actionSpecToMcpTool(spec);

    // JSON Schema should have properties for conversationId and content
    const schema = tool.inputSchema as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties).toBeDefined();
    expect(properties["conversationId"]).toBeDefined();
    expect(properties["content"]).toBeDefined();

    // Should have required fields
    const required = schema["required"] as string[];
    expect(required).toContain("conversationId");
    expect(required).toContain("content");
  });

  test("sets readOnlyHint from McpSurface.readOnly", () => {
    const readOnlySpec = createReadOnlySpec();
    const tool = actionSpecToMcpTool(readOnlySpec);

    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
  });

  test("sets destructiveHint from McpSurface.destructive", () => {
    const spec = createDestructiveSpec();
    const tool = actionSpecToMcpTool(spec);

    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });

  test("returns undefined for spec without mcp metadata", () => {
    const spec = createAdminOnlySpec();
    const tool = actionSpecToMcpTool(spec);

    expect(tool).toBeUndefined();
  });

  test("empty registry produces no tools", () => {
    const registry = createTestRegistry([]);
    const mcpSpecs = registry.listForSurface("mcp");

    expect(mcpSpecs).toHaveLength(0);
  });
});
