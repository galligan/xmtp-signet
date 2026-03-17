import type { ActionResult } from "@xmtp/signet-contracts";

/**
 * MCP content block shape returned to MCP clients.
 */
export interface McpContentResponse {
  readonly content: ReadonlyArray<{
    readonly type: "text";
    readonly text: string;
  }>;
  readonly isError: boolean;
}

/**
 * Format an ActionResult envelope as an MCP content response.
 * Both success and error cases serialize the full envelope as
 * formatted JSON. The isError flag tells the MCP client whether
 * the tool invocation succeeded.
 */
export function formatActionResult<T>(
  result: ActionResult<T>,
): McpContentResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    isError: !result.ok,
  };
}
