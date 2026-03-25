import type { SignetEvent } from "@xmtp/signet-schemas";
import type { SequencedFrame } from "./frames.js";
import type { CredentialReplayState } from "./connection-state.js";

/**
 * Wraps an event in a SequencedFrame using the credential's replay state.
 * Advances the credential's seq counter and pushes to the replay buffer.
 */
export function sequenceEvent(
  credentialState: CredentialReplayState,
  event: SignetEvent,
): SequencedFrame {
  const seq = credentialState.nextSeq;
  credentialState.nextSeq = seq + 1;
  const frame: SequencedFrame = { seq, event };
  credentialState.buffer.push(frame);
  return frame;
}
