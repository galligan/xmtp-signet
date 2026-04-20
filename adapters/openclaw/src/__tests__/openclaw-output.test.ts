import { describe, expect, test } from "bun:test";
import { formatAdapterOutput } from "../output.js";

describe("formatAdapterOutput", () => {
  test("renders nested objects and arrays as JSON in text mode", () => {
    const output = formatAdapterOutput(
      {
        status: "missing",
        details: {
          phase: "scaffold",
          bridgePhase: "scaffold",
        },
        artifacts: {
          config: "/tmp/openclaw.toml",
        },
        diagnostics: ["one", "two"],
      },
      false,
    );

    expect(output).toContain("status: missing");
    expect(output).toContain(
      'details: {"phase":"scaffold","bridgePhase":"scaffold"}',
    );
    expect(output).toContain('artifacts: {"config":"/tmp/openclaw.toml"}');
    expect(output).toContain('diagnostics: ["one","two"]');
  });

  test("preserves pretty JSON mode", () => {
    const output = formatAdapterOutput(
      {
        details: {
          phase: "scaffold",
        },
      },
      true,
    );

    expect(output).toBe('{\n  "details": {\n    "phase": "scaffold"\n  }\n}');
  });
});
