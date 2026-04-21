function formatAdapterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

/** Format adapter command output for JSON or human-readable CLI mode. */
export function formatAdapterOutput(data: unknown, json: boolean): string {
  if (json) {
    return JSON.stringify(data, null, 2);
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${formatAdapterValue(value)}`)
      .join("\n");
  }

  return formatAdapterValue(data);
}
