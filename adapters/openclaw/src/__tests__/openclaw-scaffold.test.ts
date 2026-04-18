import { describe, expect, test } from "bun:test";
import {
  OPENCLAW_ADAPTER_MANIFEST,
  openclawAdapterDefinition,
  runOpenClawDoctor,
  runOpenClawSetup,
  runOpenClawStatus,
} from "../index.js";

describe("openclaw adapter scaffold", () => {
  test("exports a built-in manifest for setup, status, and doctor", () => {
    expect(OPENCLAW_ADAPTER_MANIFEST.name).toBe("openclaw");
    expect(OPENCLAW_ADAPTER_MANIFEST.source).toBe("builtin");
    expect(OPENCLAW_ADAPTER_MANIFEST.supports).toEqual([
      "setup",
      "status",
      "doctor",
    ]);
    expect(OPENCLAW_ADAPTER_MANIFEST.entrypoints.setup).toBe(
      "builtin:openclaw:setup",
    );
  });

  test("exports process-backed registration metadata", () => {
    expect(openclawAdapterDefinition.command).toBe("bun");
    expect(openclawAdapterDefinition.args.length).toBe(1);
    expect(openclawAdapterDefinition.args[0]).toContain("bin.js");
  });

  test("returns structured stub outputs for setup, status, and doctor", () => {
    expect(runOpenClawSetup().adapter).toBe("openclaw");
    expect(runOpenClawSetup().status).toBe("missing");
    expect(runOpenClawStatus().details["phase"]).toBe("scaffold");
    expect(runOpenClawDoctor().details["phase"]).toBe("scaffold");
  });
});
