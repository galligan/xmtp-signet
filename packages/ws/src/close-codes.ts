/** WebSocket close codes used by the signet. */
export const WS_CLOSE_CODES = {
  /** Clean client disconnect. */
  NORMAL: 1000,
  /** Server shutdown. */
  GOING_AWAY: 1001,
  /** Invalid or expired token. */
  AUTH_FAILED: 4001,
  /** No auth frame within timeout. */
  AUTH_TIMEOUT: 4002,
  /** Session TTL exceeded. */
  SESSION_EXPIRED: 4003,
  /** Explicit revocation. */
  SESSION_REVOKED: 4004,
  /** Material change requires reauth. */
  POLICY_CHANGE: 4005,
  /** Send buffer hard limit exceeded. */
  BACKPRESSURE: 4008,
  /** Connection detected as dead (missed heartbeats). */
  DEAD_CONNECTION: 4010,
  /** Rate limit exceeded (policy violation). */
  RATE_LIMITED: 1008,
  /** Malformed frame or unknown type. */
  PROTOCOL_ERROR: 4009,
} as const;

/** Union of all WebSocket close codes used by the signet server. */
export type WsCloseCode = (typeof WS_CLOSE_CODES)[keyof typeof WS_CLOSE_CODES];
