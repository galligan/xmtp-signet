import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createOpenClawCheckpointStore } from "../bridge/index.js";

describe("OpenClaw checkpoint store", () => {
  test("loadLatest skips malformed checkpoint files when valid checkpoints remain", async () => {
    const root = await mkdtemp(join(tmpdir(), "openclaw-checkpoints-"));

    try {
      const checkpointsDir = join(root, "checkpoints");
      await mkdir(checkpointsDir, { recursive: true });
      await writeFile(
        join(checkpointsDir, "bad.json"),
        JSON.stringify({
          credentialId: "cred_0000000000000002",
          lastSeq: -1,
          updatedAt: "not-a-date",
        }),
      );
      await writeFile(
        join(checkpointsDir, "good.json"),
        JSON.stringify({
          credentialId: "cred_0000000000000001",
          lastSeq: 7,
          updatedAt: "2026-04-18T00:00:00.000Z",
        }),
      );

      const store = createOpenClawCheckpointStore({ checkpointsDir });
      const result = await store.loadLatest();

      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        return;
      }
      expect(result.value).not.toBeNull();
      expect(result.value?.credentialId).toBe("cred_0000000000000001");
      expect(result.value?.lastSeq).toBe(7);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
