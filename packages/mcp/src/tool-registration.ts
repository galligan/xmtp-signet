import { zodToJsonSchema } from "zod-to-json-schema";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { SignetError } from "@xmtp/signet-schemas";

/**
 * MCP tool registration shape. Produced from an ActionSpec
 * with MCP surface metadata.
 */
export interface McpToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
  };
}

/**
 * Convert an ActionSpec into an MCP tool registration.
 * Returns undefined if the spec has no MCP surface metadata.
 */
export function actionSpecToMcpTool(
  spec: ActionSpec<unknown, unknown, SignetError>,
): McpToolRegistration | undefined {
  if (!spec.mcp) {
    return undefined;
  }

  const jsonSchema = zodToJsonSchema(spec.input, {
    $refStrategy: "none",
    errorMessages: true,
  });

  return {
    name: spec.mcp.toolName,
    description: spec.mcp.description,
    inputSchema: jsonSchema as Record<string, unknown>,
    annotations: {
      readOnlyHint: spec.mcp.readOnly,
      destructiveHint: spec.mcp.destructive ?? false,
    },
  };
}
