/**
 * CLI package for xmtp-signet. Provides the `xmtp-signet` (alias `xs`) command,
 * daemon lifecycle, admin socket client/server, configuration loading,
 * and direct-mode fallback.
 * @module
 */

import { Command } from "commander";
import { createLifecycleCommands } from "./commands/lifecycle.js";
import { createIdentityCommands } from "./commands/identity.js";
import { createSessionCommands } from "./commands/session.js";
import { createGrantCommands } from "./commands/grant.js";
import { createSealCommands } from "./commands/seal.js";
import { createMessageCommands } from "./commands/message.js";
import { createConversationCommands } from "./commands/conversation.js";
import { createAdminCommands } from "./commands/admin.js";

const program: Command = new Command()
  .name("xmtp-signet")
  .alias("xs")
  .version("0.1.0")
  .description("Agent signet for XMTP");

for (const command of createLifecycleCommands()) {
  program.addCommand(command);
}
program.addCommand(createIdentityCommands());
program.addCommand(createSessionCommands());
program.addCommand(createGrantCommands());
program.addCommand(createSealCommands());
program.addCommand(createMessageCommands());
program.addCommand(createConversationCommands());
program.addCommand(createAdminCommands());

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

export type { AdminServer, AdminServerDeps } from "./admin/server.js";
export { createAdminServer } from "./admin/server.js";
export type { AdminClient } from "./admin/client.js";
export { createAdminClient } from "./admin/client.js";
export type { AdminDispatcher } from "./admin/dispatcher.js";
export { createAdminDispatcher } from "./admin/dispatcher.js";
export {
  JsonRpcRequestSchema,
  JsonRpcSuccessSchema,
  JsonRpcErrorSchema,
  JsonRpcNotificationSchema,
  AdminAuthFrameSchema,
  JSON_RPC_ERRORS,
} from "./admin/protocol.js";
export type {
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcError,
  JsonRpcNotification,
  AdminAuthFrame,
} from "./admin/protocol.js";

export { createLifecycleCommands } from "./commands/lifecycle.js";
export { createIdentityCommands } from "./commands/identity.js";
export { createSessionCommands } from "./commands/session.js";
export { createGrantCommands } from "./commands/grant.js";
export { createSealCommands } from "./commands/seal.js";
export { createMessageCommands } from "./commands/message.js";
export { createConversationCommands } from "./commands/conversation.js";
export type { ConversationCommandDeps } from "./commands/conversation.js";
export { createAdminCommands } from "./commands/admin.js";

export { exitCodeFromCategory, EXIT_SUCCESS } from "./output/exit-codes.js";
export type { OutputFormatter, FormatOptions } from "./output/formatter.js";
export {
  createOutputFormatter,
  formatOutput,
  formatNdjsonLine,
} from "./output/formatter.js";

export type { CliMode, ModeDetectionResult } from "./direct/detector.js";
export { detectMode } from "./direct/detector.js";
export type {
  DirectClient,
  DirectModeConfig,
  DirectModeDeps,
} from "./direct/client.js";
export { createDirectClient, DirectModeConfigSchema } from "./direct/client.js";
