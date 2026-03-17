/**
 * Harness-facing handler SDK. Provides `SignetHandler`, a WebSocket client
 * that connects to the signet, authenticates with a session token, receives
 * events, and sends requests through a typed interface.
 * @module
 */

export { createSignetHandler } from "./handler.js";
export { SignetHandlerConfigSchema } from "./config.js";
export type { SignetHandlerConfig } from "./config.js";
export type {
  SignetHandler,
  HandlerState,
  SessionInfo,
  StateChangeCallback,
  ErrorCallback,
  MessageContent,
  MessageSent,
  ReactionSent,
  Conversation,
  ConversationInfo,
} from "./types.js";
