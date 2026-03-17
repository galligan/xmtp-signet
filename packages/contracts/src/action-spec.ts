import type { z } from "zod";
import type { SignetError } from "@xmtp/signet-schemas";
import type { Handler } from "./handler-types.js";

/**
 * CLI option definition. Maps a CLI flag to an input schema field.
 */
export interface CliOption {
  /** Flag definition (e.g., `"--group-id <id>"`). */
  readonly flag: string;

  /** Human-readable description. */
  readonly description: string;

  /** Input schema field this maps to. Dot-path for nested fields. */
  readonly field: string;

  /** Whether this option is required. Defaults to false. */
  readonly required?: boolean;
}

/**
 * CLI-specific metadata for an ActionSpec.
 * The CLI adapter uses this to build commands, parse arguments,
 * and format output.
 */
export interface CliSurface {
  /** Command name. Colon-delimited for namespacing (e.g., `session:list`). */
  readonly command: string;

  /**
   * JSON-RPC method name for admin socket dispatch.
   * Dot-delimited (e.g., `session.list`). Derived from `command` by
   * replacing `:` with `.` if not explicitly set.
   */
  readonly rpcMethod?: string;

  /** Short aliases (e.g., `["sl"]`). */
  readonly aliases?: readonly string[];

  /** CLI option definitions. Maps CLI flags to input schema fields. */
  readonly options?: readonly CliOption[];

  /** Default output format for this command. */
  readonly outputFormat?: "table" | "json" | "text";

  /** Command group for help text organization. */
  readonly group?: string;

  /** One-line description for help text. */
  readonly description?: string;
}

/**
 * MCP-specific metadata for an ActionSpec.
 * The MCP adapter uses this to register tools with the MCP server.
 */
export interface McpSurface {
  /**
   * MCP tool name. Convention: `signet/{group}/{action}`
   * (e.g., `signet/session/list`).
   */
  readonly toolName: string;

  /** Human-readable tool description for the MCP tool listing. */
  readonly description: string;

  /** Whether this tool only reads data (no side effects). */
  readonly readOnly: boolean;

  /**
   * Whether this tool performs destructive/irreversible operations.
   * MCP clients may require confirmation for destructive tools.
   */
  readonly destructive?: boolean;

  /**
   * Additional MCP tool annotations. Passed through to the MCP
   * server as-is. See MCP spec for supported annotation keys.
   */
  readonly annotations?: Record<string, unknown>;
}

/**
 * Bundles a handler with its input schema and per-surface metadata.
 * Transport adapters consume ActionSpecs to wire domain logic into
 * their protocol. Co-located with handlers in runtime packages.
 */
export interface ActionSpec<
  TInput,
  TOutput,
  TError extends SignetError = SignetError,
> {
  /** Unique action identifier. Convention: `{domain}.{verb}` (e.g., `session.list`). */
  readonly id: string;

  /** The transport-agnostic handler function. */
  readonly handler: Handler<TInput, TOutput, TError>;

  /** Zod schema for input validation. Transports parse raw input against this. */
  readonly input: z.ZodType<TInput>;

  /** Zod schema for output validation. Optional; used for documentation and testing. */
  readonly output?: z.ZodType<TOutput>;

  /** CLI surface metadata. Omit to exclude from CLI. */
  readonly cli?: CliSurface;

  /** MCP surface metadata. Omit to exclude from MCP. */
  readonly mcp?: McpSurface;
}
