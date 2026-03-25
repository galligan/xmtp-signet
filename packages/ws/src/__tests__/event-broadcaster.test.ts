import { describe, expect, test, beforeEach } from "bun:test";
import { sequenceEvent } from "../event-broadcaster.js";
import { CircularBuffer } from "../replay-buffer.js";
import type { CredentialReplayState } from "../connection-state.js";
import type { SignetEvent } from "@xmtp/signet-schemas";
import type { SequencedFrame } from "../frames.js";

function makeCredentialState(bufferSize = 100): CredentialReplayState {
  return {
    buffer: new CircularBuffer<SequencedFrame>(bufferSize),
    nextSeq: 1,
  };
}

describe("sequenceEvent", () => {
  const heartbeatEvent: SignetEvent = {
    type: "heartbeat",
    credentialId: "cred_1",
    timestamp: "2024-01-01T00:00:00Z",
  };

  let credentialState: CredentialReplayState;

  beforeEach(() => {
    credentialState = makeCredentialState();
  });

  test("assigns monotonically increasing seq", () => {
    const frame1 = sequenceEvent(credentialState, heartbeatEvent);
    const frame2 = sequenceEvent(credentialState, heartbeatEvent);
    const frame3 = sequenceEvent(credentialState, heartbeatEvent);
    expect(frame1.seq).toBe(1);
    expect(frame2.seq).toBe(2);
    expect(frame3.seq).toBe(3);
  });

  test("advances credential nextSeq", () => {
    expect(credentialState.nextSeq).toBe(1);
    sequenceEvent(credentialState, heartbeatEvent);
    expect(credentialState.nextSeq).toBe(2);
  });

  test("pushes frame into credential replay buffer", () => {
    const frame = sequenceEvent(credentialState, heartbeatEvent);
    expect(credentialState.buffer.size).toBe(1);
    expect(credentialState.buffer.oldest()).toEqual(frame);
  });

  test("independent seq counters per credential", () => {
    const cred1 = makeCredentialState();
    const cred2 = makeCredentialState();
    const frame1 = sequenceEvent(cred1, heartbeatEvent);
    const frame2 = sequenceEvent(cred2, heartbeatEvent);
    expect(frame1.seq).toBe(1);
    expect(frame2.seq).toBe(1);
  });

  test("resumes from custom nextSeq", () => {
    credentialState.nextSeq = 42;
    const frame = sequenceEvent(credentialState, heartbeatEvent);
    expect(frame.seq).toBe(42);
    expect(credentialState.nextSeq).toBe(43);
  });
});
