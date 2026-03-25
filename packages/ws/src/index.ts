// Configuration
export { WsServerConfigSchema, type WsServerConfig } from "./config.js";

// Close codes
export { WS_CLOSE_CODES, type WsCloseCode } from "./close-codes.js";

// Frame schemas
export {
  AuthFrame,
  AuthenticatedFrame,
  AuthErrorFrame,
  BackpressureFrame,
  SequencedFrame,
  InboundFrame,
} from "./frames.js";

// Connection state
export {
  type ConnectionPhase,
  type ConnectionData,
  type CredentialReplayState,
  createConnectionState,
  canTransition,
  transition,
} from "./connection-state.js";

// Connection registry
export { ConnectionRegistry } from "./connection-registry.js";

// Replay buffer
export { CircularBuffer } from "./replay-buffer.js";

// Backpressure
export { BackpressureTracker, type BackpressureState } from "./backpressure.js";

// Auth handler
export { handleAuth, type TokenLookup } from "./auth-handler.js";

// Request router
export { routeRequest, type RequestHandler } from "./request-router.js";

// Event broadcaster
export { sequenceEvent } from "./event-broadcaster.js";

// Server
export {
  createWsServer,
  type WsServer,
  type WsServerState,
  type WsServerDeps,
  type CredentialLookup,
} from "./server.js";
