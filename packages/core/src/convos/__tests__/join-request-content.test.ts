import { describe, expect, test } from "bun:test";
import {
  ContentTypeJoinRequest,
  JoinRequestCodec,
  decodeJoinRequest,
  extractJoinRequestContent,
  type JoinRequestContent,
} from "../join-request-content.js";

describe("join-request-content", () => {
  test("round-trips a structured join request with profile metadata", () => {
    const original: JoinRequestContent = {
      inviteSlug: "signed-slug-123",
      profile: {
        name: "Codex",
        memberKind: "agent",
      },
      metadata: {
        source: "signet",
      },
    };

    const codec = new JoinRequestCodec();
    const encoded = codec.encode(original);
    const decoded = decodeJoinRequest(encoded);

    expect(encoded.type).toEqual(ContentTypeJoinRequest);
    expect(decoded).toEqual(original);
    expect(codec.fallback(original)).toBe("signed-slug-123");
  });

  test("extracts join request content from decoded message payloads", () => {
    const payload = {
      inviteSlug: "signed-slug-456",
      profile: { memberKind: "agent" },
    };

    expect(extractJoinRequestContent(payload)).toEqual(payload);
  });
});
