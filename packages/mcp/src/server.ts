import { Result } from "better-result";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ActionResultMeta } from "@xmtp/signet-schemas";
import { InternalError, AuthError } from "@xmtp/signet-schemas";
import type {
  ActionRegistry,
  CredentialRecord,
  SignerProvider,
} from "@xmtp/signet-contracts";
import type { McpServerConfig } from "./config.js";
import { McpServerConfigSchema } from "./config.js";
import {
  actionSpecToMcpTool,
  type McpToolRegistration,
} from "./tool-registration.js";
import { handleCallTool } from "./call-handler.js";
import {
  validateCredential,
  checkCredentialLiveness,
  type TokenLookup,
  type CredentialLookup,
} from "./credential-guard.js";
import { formatActionResult } from "./output-formatter.js";
import { toActionResult } from "@xmtp/signet-contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCP server lifecycle states. */
export type McpServerState = "idle" | "running" | "stopping" | "stopped";

/** Dependencies injected into the MCP server. */
export interface McpServerDeps {
  readonly registry: ActionRegistry;
  readonly signetId: string;
  readonly signerProvider: SignerProvider;
  readonly tokenLookup: TokenLookup;
  readonly credentialLookup: CredentialLookup;
}

/** Credential-scoped MCP server instance exposing signet actions as MCP tools. */
export interface McpServerInstance {
  /** Start the server: validate credential, discover tools, connect transport. */
  start(): Promise<Result<void, InternalError | AuthError>>;

  /** Stop the server and close the underlying MCP SDK server. */
  stop(): Promise<Result<void, InternalError>>;

  /** Current server lifecycle state. */
  readonly state: McpServerState;

  /** Number of registered MCP tools. */
  readonly toolCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeta(requestId: string, startTime: number): ActionResultMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a credential-scoped MCP server that exposes signet ActionSpecs
 * as MCP tools. Validates the credential token at startup and checks
 * liveness on each tool call.
 */
export function createMcpServer(
  rawConfig: Partial<McpServerConfig> & { credentialToken: string },
  deps: McpServerDeps,
): McpServerInstance {
  const config = McpServerConfigSchema.parse(rawConfig);

  let state: McpServerState = "idle";
  let cachedCredential: CredentialRecord | undefined;
  let sdkServer: Server | undefined;
  const tools: McpToolRegistration[] = [];

  return {
    get state() {
      return state;
    },

    get toolCount() {
      return tools.length;
    },

    async start() {
      // Validate credential token
      const credentialResult = await validateCredential(
        config.credentialToken,
        deps.tokenLookup,
      );
      if (!credentialResult.isOk()) {
        return Result.err(
          AuthError.create("Invalid credential token at startup"),
        );
      }
      cachedCredential = credentialResult.value;

      // Discover MCP tools from registry
      const mcpSpecs = deps.registry.listForSurface("mcp");
      for (const spec of mcpSpecs) {
        const tool = actionSpecToMcpTool(spec);
        if (tool) {
          tools.push(tool);
        }
      }

      // Create MCP SDK Server
      sdkServer = new Server(
        { name: config.serverName, version: config.serverVersion },
        { capabilities: { tools: {} } },
      );

      // Register ListTools handler
      sdkServer.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations,
          })),
        };
      });

      // Register CallTool handler
      sdkServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        const startTime = Date.now();

        if (!cachedCredential) {
          const error = AuthError.create("No active credential");
          const actionResult = toActionResult(
            Result.err(error),
            buildMeta("unknown", startTime),
          );
          const formatted = formatActionResult(actionResult);
          return {
            content: formatted.content as Array<{
              type: "text";
              text: string;
            }>,
            isError: formatted.isError,
          };
        }

        // Credential liveness check
        const livenessResult = await checkCredentialLiveness(
          cachedCredential,
          deps.credentialLookup,
        );
        if (!livenessResult.isOk()) {
          state = "stopping";
          const error = livenessResult.error;
          const actionResult = toActionResult(
            Result.err(error),
            buildMeta("unknown", startTime),
          );
          const formatted = formatActionResult(actionResult);
          return {
            content: formatted.content as Array<{
              type: "text";
              text: string;
            }>,
            isError: formatted.isError,
          };
        }

        const callResult = await handleCallTool(
          {
            name: request.params.name,
            arguments: (request.params.arguments ?? {}) as Record<
              string,
              unknown
            >,
          },
          deps.registry,
          {
            signetId: deps.signetId,
            signerProvider: deps.signerProvider,
            credentialRecord: cachedCredential,
            requestTimeoutMs: config.requestTimeoutMs,
          },
        );

        return {
          content: callResult.content as Array<{
            type: "text";
            text: string;
          }>,
          isError: callResult.isError,
        };
      });

      // Connect transport
      if (config.mode === "stdio") {
        const transport = new StdioServerTransport();
        await sdkServer.connect(transport);
      } else {
        // Embedded mode requires an external transport to be connected.
        // Mark as running but callers must connect a transport via the
        // MCP SDK server before making requests.
        return Result.err(
          InternalError.create(
            "Embedded mode is not yet supported: no transport available",
          ),
        );
      }

      state = "running";
      return Result.ok(undefined);
    },

    async stop() {
      state = "stopping";

      try {
        if (sdkServer) {
          await sdkServer.close();
        }
      } catch {
        // Best-effort close
      }

      state = "stopped";
      return Result.ok(undefined);
    },
  };
}
