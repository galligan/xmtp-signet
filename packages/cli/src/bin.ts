#!/usr/bin/env bun
/**
 * CLI entry point. Parses argv and runs the matched command.
 */
import { program } from "./index.js";

await program.parseAsync(process.argv);
