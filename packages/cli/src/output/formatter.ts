/**
 * Output formatting utilities for CLI commands.
 *
 * Supports JSON, table, and text output modes.
 * All commands use --json for machine-readable output.
 * Streaming commands use NDJSON (one JSON object per line).
 */

/** Formatter interface for structured output. */
export interface OutputFormatter {
  table(data: Record<string, unknown>[], columns?: string[]): string;
  json(data: unknown): string;
  text(message: string): string;
}

/** Options for formatOutput convenience function. */
export interface FormatOptions {
  readonly json?: boolean;
  readonly format?: "table" | "json" | "text";
}

/** Create an OutputFormatter instance. */
export function createOutputFormatter(): OutputFormatter {
  return {
    json(data: unknown): string {
      return JSON.stringify(data, null, 2);
    },

    text(message: string): string {
      return message;
    },

    table(data: Record<string, unknown>[], columns?: string[]): string {
      if (data.length === 0) {
        return "";
      }

      // Determine which columns to show
      const cols = columns ?? Object.keys(data[0] as Record<string, unknown>);

      // Calculate column widths
      const widths = new Map<string, number>();
      for (const col of cols) {
        widths.set(col, col.length);
      }
      for (const row of data) {
        for (const col of cols) {
          const val = String(row[col] ?? "");
          const current = widths.get(col) ?? 0;
          if (val.length > current) {
            widths.set(col, val.length);
          }
        }
      }

      // Build header
      const header = cols
        .map((col) => col.padEnd(widths.get(col) ?? 0))
        .join("  ");
      const separator = cols
        .map((col) => "-".repeat(widths.get(col) ?? 0))
        .join("  ");

      // Build rows
      const rows = data.map((row) =>
        cols
          .map((col) => String(row[col] ?? "").padEnd(widths.get(col) ?? 0))
          .join("  "),
      );

      return [header, separator, ...rows].join("\n");
    },
  };
}

/**
 * Format data for CLI output based on options.
 *
 * - json=true or format="json": pretty-printed JSON
 * - format="table": aligned table for arrays of records
 * - format="text": plain text
 * - Default: key-value text for objects, table for arrays
 */
export function formatOutput(data: unknown, options: FormatOptions): string {
  const formatter = createOutputFormatter();

  // JSON mode takes priority
  if (options.json === true || options.format === "json") {
    return formatter.json(data);
  }

  // Explicit text format
  if (options.format === "text") {
    return typeof data === "string" ? data : String(data);
  }

  // Explicit table format or array data
  if (
    options.format === "table" ||
    (Array.isArray(data) && options.format === undefined)
  ) {
    if (Array.isArray(data)) {
      return formatter.table(data as Record<string, unknown>[]);
    }
  }

  // Default: key-value rendering for objects
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    return entries.map(([key, value]) => `${key}: ${String(value)}`).join("\n");
  }

  return String(data);
}

/** Format a single data item as NDJSON (single-line JSON + newline). */
export function formatNdjsonLine(data: unknown): string {
  return JSON.stringify(data) + "\n";
}
