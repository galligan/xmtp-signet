import { describe, expect, test, beforeEach } from "bun:test";
import { sequenceEvent } from "../event-broadcaster.js";
import { CircularBuffer } from "../replay-buffer.js";
import type { SessionReplayState } from "../connection-state.js";
import type { SignetEvent } from "@xmtp/signet-schemas";
import type { SequencedFrame } from "../frames.js";

function makeSessionState(bufferSize = 100): SessionReplayState {
  return {
    buffer: new CircularBuffer<SequencedFrame>(bufferSize),
    nextSeq: 1,
  };
}

describe("sequenceEvent", () => {
  const heartbeatEvent: SignetEvent = {
    type: "heartbeat",
    sessionId: "sess_1",
    timestamp: "2024-01-01T00:00:00Z",
  };

  let sessionState: SessionReplayState;

  beforeEach(() => {
    sessionState = makeSessionState();
  });

  test("assigns monotonically increasing seq", () => {
    const frame1 = sequenceEvent(sessionState, heartbeatEvent);
    const frame2 = sequenceEvent(sessionState, heartbeatEvent);
    const frame3 = sequenceEvent(sessionState, heartbeatEvent);
    expect(frame1.seq).toBe(1);
    expect(frame2.seq).toBe(2);
    expect(frame3.seq).toBe(3);
  });

  test("advances session nextSeq", () => {
    expect(sessionState.nextSeq).toBe(1);
    sequenceEvent(sessionState, heartbeatEvent);
    expect(sessionState.nextSeq).toBe(2);
  });

  test("pushes frame into session replay buffer", () => {
    const frame = sequenceEvent(sessionState, heartbeatEvent);
    expect(sessionState.buffer.size).toBe(1);
    expect(sessionState.buffer.oldest()).toEqual(frame);
  });

  test("independent seq counters per session", () => {
    const session1 = makeSessionState();
    const session2 = makeSessionState();
    const frame1 = sequenceEvent(session1, heartbeatEvent);
    const frame2 = sequenceEvent(session2, heartbeatEvent);
    expect(frame1.seq).toBe(1);
    expect(frame2.seq).toBe(1);
  });

  test("resumes from custom nextSeq", () => {
    sessionState.nextSeq = 42;
    const frame = sequenceEvent(sessionState, heartbeatEvent);
    expect(frame.seq).toBe(42);
    expect(sessionState.nextSeq).toBe(43);
  });
});
