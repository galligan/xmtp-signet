#!/usr/bin/env bun

import { Command } from "commander";
import { runOpenClawDoctor } from "./doctor/index.js";
import { runOpenClawSetup } from "./setup/index.js";
import { runOpenClawStatus } from "./status/index.js";

function formatAdapterOutput(data: unknown, json: boolean): string {
  if (json) {
    return JSON.stringify(data, null, 2);
  }

  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("\n");
  }

  return String(data);
}

function addVerb(
  program: Command,
  verb: "setup" | "status" | "doctor",
  run: () => unknown,
): void {
  program
    .command(verb)
    .requiredOption("--adapter <name>", "Adapter name")
    .requiredOption("--entrypoint <name>", "Entrypoint identifier")
    .requiredOption("--config <path>", "Resolved signet config path")
    .option("--json", "JSON output")
    .action(
      (opts: {
        adapter: string;
        entrypoint: string;
        config: string;
        json?: true;
      }) => {
        const output = run();
        process.stdout.write(
          formatAdapterOutput(
            {
              ...((output ?? {}) as Record<string, unknown>),
              adapter: opts.adapter,
              entrypoint: opts.entrypoint,
              configPath: opts.config,
            },
            opts.json === true,
          ) + "\n",
        );
      },
    );
}

const program = new Command()
  .name("openclaw-adapter")
  .description("Process-backed OpenClaw adapter for xmtp-signet");

addVerb(program, "setup", runOpenClawSetup);
addVerb(program, "status", runOpenClawStatus);
addVerb(program, "doctor", runOpenClawDoctor);

await program.parseAsync(process.argv);
