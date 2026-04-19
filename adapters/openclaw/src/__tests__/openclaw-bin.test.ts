import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { InternalError, ValidationError } from "@xmtp/signet-schemas";
import { runOpenClawAdapterCommand, unwrapAdapterOutput } from "../bin.js";

describe("openclaw adapter bin", () => {
  test("unwrapAdapterOutput returns success payloads unchanged", () => {
    expect(unwrapAdapterOutput({ ok: true })).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  test("runOpenClawAdapterCommand writes formatted success output", async () => {
    const writes: string[] = [];
    const exits: number[] = [];

    await runOpenClawAdapterCommand(
      async () =>
        Result.ok({
          status: "ok",
          created: [],
        }),
      {
        adapter: "openclaw",
        entrypoint: "builtin:openclaw:setup",
        config: "/tmp/signet.toml",
        json: true,
      },
      {
        stdout(message) {
          writes.push(message);
        },
        stderr(message) {
          writes.push(`stderr:${message}`);
        },
        exit(code) {
          exits.push(code);
        },
      },
    );

    expect(exits).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? "{}")).toMatchObject({
      adapter: "openclaw",
      entrypoint: "builtin:openclaw:setup",
      configPath: "/tmp/signet.toml",
      status: "ok",
    });
  });

  test("runOpenClawAdapterCommand emits errors to stderr and exits non-zero", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exits: number[] = [];

    await runOpenClawAdapterCommand(
      () =>
        Result.err(
          ValidationError.create(
            "adapter.configPath",
            "Config path is invalid",
          ),
        ),
      {
        adapter: "openclaw",
        entrypoint: "builtin:openclaw:setup",
        config: "/tmp/signet.toml",
        json: true,
      },
      {
        stdout(message) {
          stdout.push(message);
        },
        stderr(message) {
          stderr.push(message);
        },
        exit(code) {
          exits.push(code);
        },
      },
    );

    expect(stdout).toEqual([]);
    expect(stderr[0]).toContain("ValidationError");
    expect(exits[0]).toBeGreaterThan(0);
  });

  test("runOpenClawAdapterCommand wraps thrown exceptions as internal errors", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exits: number[] = [];

    await runOpenClawAdapterCommand(
      async () => {
        throw new Error("disk full");
      },
      {
        adapter: "openclaw",
        entrypoint: "builtin:openclaw:setup",
        config: "/tmp/signet.toml",
        json: true,
      },
      {
        stdout(message) {
          stdout.push(message);
        },
        stderr(message) {
          stderr.push(message);
        },
        exit(code) {
          exits.push(code);
        },
      },
    );

    expect(stdout).toEqual([]);
    const error = JSON.parse(stderr[0] ?? "{}");
    expect(error.error).toBe(InternalError.name);
    expect(error.context.error).toBe("disk full");
    expect(exits[0]).toBeGreaterThan(0);
  });
});
