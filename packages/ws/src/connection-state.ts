import type { CredentialRecord } from "@xmtp/signet-contracts";
import { CircularBuffer } from "./replay-buffer.js";
import { BackpressureTracker } from "./backpressure.js";
import type { SequencedFrame } from "./frames.js";

/** Lifecycle phases for a websocket connection. */
export type ConnectionPhase =
  | "authenticating"
  | "active"
  | "draining"
  | "closed";

/** Valid state transitions for the connection lifecycle. */
const VALID_TRANSITIONS: Record<ConnectionPhase, readonly ConnectionPhase[]> = {
  authenticating: ["active", "closed"],
  active: ["draining", "closed"],
  draining: ["closed"],
  closed: [],
};

/**
 * Per-credential replay state: buffer + seq counter.
 * Shared across reconnections of the same credential.
 */
export interface CredentialReplayState {
  buffer: CircularBuffer<SequencedFrame>;
  nextSeq: number;
}

/**
 * Per-connection state stored in `ws.data`.
 * Also used as the type parameter for Bun's `ServerWebSocket<ConnectionData>`.
 */
export interface ConnectionData {
  readonly connectionId: string;
  phase: ConnectionPhase;
  credentialRecord: CredentialRecord | null;
  credentialId: string | null;
  operatorId: string | null;
  /** Attached after auth succeeds; shared across reconnections. */
  credentialReplayState: CredentialReplayState | null;
  backpressure: BackpressureTracker;
  authTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  inFlightRequests: Map<
    string,
    { timer: ReturnType<typeof setTimeout>; sentAt: number }
  >;
  /** Timestamp of last inbound message from client (for dead-connection detection). */
  lastClientActivity: number;
  /** Rate limiting: message count in current window. */
  messageCount: number;
  /** Rate limiting: start of current window (ms since epoch). */
  messageWindowStart: number;
}

let connectionCounter = 0;

/** Create the initial per-connection state attached to `ws.data`. */
export function createConnectionState(
  softLimit = 64,
  hardLimit = 256,
): ConnectionData {
  connectionCounter++;
  const now = Date.now();
  return {
    connectionId: `conn_${now}_${connectionCounter}`,
    phase: "authenticating",
    credentialRecord: null,
    credentialId: null,
    operatorId: null,
    credentialReplayState: null,
    backpressure: new BackpressureTracker(softLimit, hardLimit),
    authTimer: null,
    heartbeatTimer: null,
    inFlightRequests: new Map(),
    lastClientActivity: now,
    messageCount: 0,
    messageWindowStart: now,
  };
}

/** Check whether a websocket connection can move between two phases. */
export function canTransition(
  from: ConnectionPhase,
  to: ConnectionPhase,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/**
 * Attempt a phase transition. Returns true if successful, false if invalid.
 * Mutates state.phase on success.
 */
export function transition(
  state: ConnectionData,
  to: ConnectionPhase,
): boolean {
  if (!canTransition(state.phase, to)) return false;
  state.phase = to;
  return true;
}
