/**
 * Harness-facing handler SDK. Provides `BrokerHandler`, a WebSocket client
 * that connects to the broker, authenticates with a session token, receives
 * events, and sends requests through a typed interface.
 * @module
 */

export { createBrokerHandler } from "./handler.js";
export { BrokerHandlerConfigSchema } from "./config.js";
export type { BrokerHandlerConfig } from "./config.js";
export type {
  BrokerHandler,
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
