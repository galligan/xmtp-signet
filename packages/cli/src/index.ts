/**
 * CLI package for xmtp-signet. Provides the `xs` command,
 * daemon lifecycle, admin socket client/server, configuration loading,
 * and direct-mode fallback.
 * @module
 */

import { Command } from "commander";
import { createXsProgram } from "./xs-program.js";

const program: Command = createXsProgram();

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
export { buildKeysCommand } from "./commands/keys.js";

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

export { createXsProgram } from "./xs-program.js";
