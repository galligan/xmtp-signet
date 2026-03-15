import { Command } from "commander";

const program: Command = new Command()
  .name("xmtp-broker")
  .version("0.1.0")
  .description("Agent broker for XMTP");

export { program };

export type { CliConfig, AdminServerConfig } from "./config/schema.js";
export { CliConfigSchema, AdminServerConfigSchema } from "./config/schema.js";
export type { ResolvedPaths } from "./config/paths.js";
export { resolvePaths } from "./config/paths.js";
export { loadConfig } from "./config/loader.js";
