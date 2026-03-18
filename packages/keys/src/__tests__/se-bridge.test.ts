import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Result } from "better-result";
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  seCreate,
  seSign,
  seInfo,
  seDelete,
  findSignerBinary,
} from "../se-bridge.js";

/**
 * Create a mock signer script that echoes predefined JSON responses.
 * The script reads the subcommand from argv and returns matching JSON.
 */
function createMockSigner(
  tmpDir: string,
  responses: Record<string, string>,
  exitCode = 0,
): string {
  const scriptPath = join(tmpDir, "mock-signet-signer");

  // Build a bash script that switches on the first argument
  const cases = Object.entries(responses)
    .map(([cmd, json]) => `    "${cmd}") echo '${json}' ;;`)
    .join("\n");

  const script = `#!/usr/bin/env bash
case "$1" in
${cases}
    *) echo '{}' ;;
esac
exit ${exitCode}
`;

  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createFailingSigner(
  tmpDir: string,
  stderr: string,
  exitCode: number,
): string {
  const scriptPath = join(tmpDir, "fail-signet-signer");
  const script = `#!/usr/bin/env bash
echo "error: ${stderr}" >&2
exit ${exitCode}
`;
  writeFileSync(scriptPath, script);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe("se-bridge", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "se-bridge-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("seCreate", () => {
    test("parses valid create response", async () => {
      const signer = createMockSigner(tmpDir, {
        create: '{"keyRef":"dGVzdA==","publicKey":"04abcdef","policy":"open"}',
      });

      const result = await seCreate("test-key", "open", signer);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("expected ok");
      expect(result.value.keyRef).toBe("dGVzdA==");
      expect(result.value.publicKey).toBe("04abcdef");
      expect(result.value.policy).toBe("open");
    });

    test("returns error on invalid JSON", async () => {
      const scriptPath = join(tmpDir, "bad-json-signer");
      writeFileSync(scriptPath, '#!/usr/bin/env bash\necho "not json"\n');
      chmodSync(scriptPath, 0o755);

      const result = await seCreate("test-key", "open", scriptPath);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error.message).toContain("invalid JSON");
    });

    test("returns error on schema validation failure", async () => {
      const signer = createMockSigner(tmpDir, {
        create: '{"wrong":"fields"}',
      });

      const result = await seCreate("test-key", "open", signer);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error.message).toContain("validation failed");
    });
  });

  describe("seSign", () => {
    test("parses valid sign response", async () => {
      const signer = createMockSigner(tmpDir, {
        sign: '{"signature":"3045022100deadbeef"}',
      });

      const data = new Uint8Array([1, 2, 3]);
      const result = await seSign("dGVzdA==", data, signer);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("expected ok");
      expect(result.value.signature).toBe("3045022100deadbeef");
    });
  });

  describe("seInfo", () => {
    test("parses valid system info response", async () => {
      const signer = createMockSigner(tmpDir, {
        info: '{"available":true,"chip":"Apple M2","macOS":"15.3"}',
      });

      const result = await seInfo(signer);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("expected ok");
      expect(result.value.available).toBe(true);
      expect(result.value.chip).toBe("Apple M2");
    });

    test("handles SE unavailable", async () => {
      const signer = createMockSigner(tmpDir, {
        info: '{"available":false,"chip":null,"macOS":"15.3"}',
      });

      const result = await seInfo(signer);
      expect(Result.isOk(result)).toBe(true);
      if (Result.isError(result)) throw new Error("expected ok");
      expect(result.value.available).toBe(false);
    });
  });

  describe("seDelete", () => {
    test("succeeds on exit code 0", async () => {
      const signer = createMockSigner(tmpDir, { delete: "{}" });

      const result = await seDelete("dGVzdA==", signer);
      expect(Result.isOk(result)).toBe(true);
    });
  });

  describe("error handling", () => {
    test("returns error on non-zero exit code", async () => {
      const signer = createFailingSigner(tmpDir, "SE unavailable", 1);

      const result = await seInfo(signer);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error.message).toContain("signet-signer failed");
    });

    test("returns auth cancelled error on exit code 2", async () => {
      const signer = createFailingSigner(tmpDir, "authentication cancelled", 2);

      const result = await seInfo(signer);
      expect(Result.isError(result)).toBe(true);
      if (Result.isOk(result)) throw new Error("expected error");
      expect(result.error.message).toContain("authentication cancelled");
    });

    test("returns error on missing binary", async () => {
      const result = await seInfo("/nonexistent/signet-signer");
      expect(Result.isError(result)).toBe(true);
    });
  });

  describe("findSignerBinary", () => {
    test("returns string or null", () => {
      const result = findSignerBinary();
      // On macOS dev machines with a build, this should find the binary.
      // On CI without a build, it returns null. Either is valid.
      expect(result === null || typeof result === "string").toBe(true);
    });
  });
});
