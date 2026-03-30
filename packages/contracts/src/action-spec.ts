import type { z } from "zod";
import type { SignetError } from "@xmtp/signet-schemas";
import type { Handler } from "./handler-types.js";

/** Action transport surfaces supported by the contracts package. */
export const ACTION_SURFACES = ["cli", "mcp", "http"] as const;

/** Action transport surface name. */
export type ActionSurface = (typeof ACTION_SURFACES)[number];

/**
 * Authored action intent. Borrowed directly from the Trails cleanup:
 * one semantic field beats scattered per-surface safety booleans.
 */
export type ActionIntent = "read" | "write" | "destroy";

/**
 * Named example for documentation and executable contract checks.
 * The input is partial so schema defaults can be omitted in examples.
 */
export interface ActionExample<TInput, TOutput> {
  /** Human-readable example name. */
  readonly name: string;

  /** Optional short description of what the example demonstrates. */
  readonly description?: string;

  /** Example input. Fields with schema defaults may be omitted. */
  readonly input: Partial<TInput>;

  /** Expected success output for the example. */
  readonly expected?: TOutput;

  /** Expected error class/category name for failure examples. */
  readonly error?: string;
}

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
  /** Optional command override. When omitted, transports may derive from `id`. */
  readonly command?: string;

  /** Short aliases (e.g., `["sl"]`). */
  readonly aliases?: readonly string[];

  /** CLI option definitions. Maps CLI flags to input schema fields. */
  readonly options?: readonly CliOption[];

  /** Default output format for this command. */
  readonly outputFormat?: "table" | "json" | "text";

  /** Command group for help text organization. */
  readonly group?: string;
}

/**
 * MCP-specific metadata for an ActionSpec.
 * The MCP adapter uses this to register tools with the MCP server.
 */
export interface McpSurface {
  /**
   * Optional tool name override. When omitted, transports may derive
   * from `id`.
   */
  readonly toolName?: string;

  /**
   * Additional MCP tool annotations. Passed through to the MCP
   * server as-is. See MCP spec for supported annotation keys.
   */
  readonly annotations?: Record<string, unknown>;
}

/**
 * HTTP-specific metadata for an ActionSpec.
 * The HTTP adapter uses this to expose credential/admin action routes.
 */
export interface HttpSurface {
  /** Optional path override. When omitted, transports may derive from `id`. */
  readonly path?: string;

  /** Optional method override. When omitted, transports may derive from `intent`. */
  readonly method?: "GET" | "POST" | "DELETE";

  /** Required auth context for the HTTP surface. */
  readonly auth: "admin" | "credential";

  /** Whether the action should be exposed over HTTP. Defaults to true. */
  readonly expose?: boolean;
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
  /** Unique action identifier. Convention: `{domain}.{verb}` (e.g., `credential.list`). */
  readonly id: string;

  /** The transport-agnostic handler function. */
  readonly handler: Handler<TInput, TOutput, TError>;

  /** Zod schema for input validation. Transports parse raw input against this. */
  readonly input: z.ZodType<TInput>;

  /** Zod schema for output validation. Optional; used for documentation and testing. */
  readonly output?: z.ZodType<TOutput>;

  /** Human-readable description for documentation and default surface text. */
  readonly description?: string;

  /** Named examples for documentation and executable contract tests. */
  readonly examples?: readonly ActionExample<TInput, TOutput>[];

  /** Semantic action intent. Defaults to `write` in derivation helpers. */
  readonly intent?: ActionIntent;

  /** Whether repeated execution is safe. Orthogonal to `intent`. */
  readonly idempotent?: boolean;

  /** Arbitrary metadata for curation, filtering, and future governance. */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /** CLI surface metadata. Omit to exclude from CLI. */
  readonly cli?: CliSurface;

  /** MCP surface metadata. Omit to exclude from MCP. */
  readonly mcp?: McpSurface;

  /** HTTP surface metadata. Omit to exclude from HTTP. */
  readonly http?: HttpSurface;
}
