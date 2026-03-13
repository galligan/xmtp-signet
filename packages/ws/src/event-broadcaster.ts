import type { BrokerEvent } from "@xmtp-broker/schemas";
import type { SequencedFrame } from "./frames.js";
import type { SessionReplayState } from "./connection-state.js";

/**
 * Wraps an event in a SequencedFrame using the session's replay state.
 * Advances the session's seq counter and pushes to the replay buffer.
 */
export function sequenceEvent(
  sessionState: SessionReplayState,
  event: BrokerEvent,
): SequencedFrame {
  const seq = sessionState.nextSeq;
  sessionState.nextSeq = seq + 1;
  const frame: SequencedFrame = { seq, event };
  sessionState.buffer.push(frame);
  return frame;
}
