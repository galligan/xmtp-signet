#!/usr/bin/env bun

import { Command } from "commander";
import { runOpenClawDoctor } from "./doctor/index.js";
import { formatAdapterOutput } from "./output.js";
import { runOpenClawSetup } from "./setup/index.js";
import { runOpenClawStatus } from "./status/index.js";

function addVerb(
  program: Command,
  verb: "setup" | "status" | "doctor",
  run: (opts: {
    adapter: string;
    entrypoint: string;
    config: string;
    force?: true;
  }) => Promise<unknown> | unknown,
): void {
  program
    .command(verb)
    .requiredOption("--adapter <name>", "Adapter name")
    .requiredOption("--entrypoint <name>", "Entrypoint identifier")
    .requiredOption("--config <path>", "Resolved signet config path")
    .option("--force", "Overwrite generated adapter artifacts when needed")
    .option("--json", "JSON output")
    .action(
      async (opts: {
        adapter: string;
        entrypoint: string;
        config: string;
        force?: true;
        json?: true;
      }) => {
        const output = await run(opts);
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

addVerb(program, "setup", (opts) =>
  runOpenClawSetup({
    configPath: opts.config,
    force: opts.force,
  }),
);
addVerb(program, "status", () => runOpenClawStatus());
addVerb(program, "doctor", () => runOpenClawDoctor());

await program.parseAsync(process.argv);
