import { describe, test, expect } from "bun:test";
import {
  LIVENESS_CONTENT_TYPE_ID,
  LivenessMessage,
  encodeLivenessMessage,
} from "../content-type.js";

describe("liveness content type", () => {
  test("LIVENESS_CONTENT_TYPE_ID follows naming convention", () => {
    expect(LIVENESS_CONTENT_TYPE_ID).toBe("xmtp.org/agentLiveness:1.0");
  });

  test("encodeLivenessMessage attaches contentType discriminator", () => {
    const msg = encodeLivenessMessage({
      agentInboxId: "agent-1",
      timestamp: "2024-01-01T00:00:00Z",
      heartbeatIntervalSeconds: 30,
    });

    expect(msg.contentType).toBe(LIVENESS_CONTENT_TYPE_ID);
    expect(msg.agentInboxId).toBe("agent-1");
    expect(msg.timestamp).toBe("2024-01-01T00:00:00Z");
    expect(msg.heartbeatIntervalSeconds).toBe(30);
  });

  test("LivenessMessage schema validates correct payload", () => {
    const result = LivenessMessage.safeParse({
      agentInboxId: "agent-1",
      timestamp: "2024-01-01T00:00:00Z",
      heartbeatIntervalSeconds: 30,
      contentType: LIVENESS_CONTENT_TYPE_ID,
    });
    expect(result.success).toBe(true);
  });

  test("LivenessMessage schema rejects invalid timestamp", () => {
    const result = LivenessMessage.safeParse({
      agentInboxId: "agent-1",
      timestamp: "not-a-date",
      heartbeatIntervalSeconds: 30,
      contentType: LIVENESS_CONTENT_TYPE_ID,
    });
    expect(result.success).toBe(false);
  });

  test("LivenessMessage schema rejects wrong content type", () => {
    const result = LivenessMessage.safeParse({
      agentInboxId: "agent-1",
      timestamp: "2024-01-01T00:00:00Z",
      heartbeatIntervalSeconds: 30,
      contentType: "xmtp.org/wrong:1.0",
    });
    expect(result.success).toBe(false);
  });
});
