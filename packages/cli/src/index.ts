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

export type {
  DaemonState,
  DaemonLifecycle,
  DaemonLifecycleCallbacks,
} from "./daemon/lifecycle.js";
export { createDaemonLifecycle } from "./daemon/lifecycle.js";
export type { PidFile, PidFileData } from "./daemon/pid.js";
export { createPidFile } from "./daemon/pid.js";
export { setupSignalHandlers } from "./daemon/signals.js";
export type { DaemonStatus } from "./daemon/status.js";
export { DaemonStatusSchema } from "./daemon/status.js";
