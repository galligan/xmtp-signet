/**
 * Lightweight adapter-facing CLI support surface.
 *
 * This entrypoint intentionally avoids the full `xs` program graph so harness
 * adapters can reuse config and admin helpers without importing command
 * surfaces or XMTP runtime bindings during unit tests.
 *
 * @module
 */

export type { CliConfig } from "./config/schema.js";
export { CliConfigSchema } from "./config/schema.js";
export type { ResolvedPaths } from "./config/paths.js";
export { resolvePaths } from "./config/paths.js";
export { loadConfig } from "./config/loader.js";
export type { AdminClient } from "./admin/client.js";
export { createAdminClient } from "./admin/client.js";
export type { DaemonStatus } from "./daemon/status.js";
export { DaemonStatusSchema } from "./daemon/status.js";
