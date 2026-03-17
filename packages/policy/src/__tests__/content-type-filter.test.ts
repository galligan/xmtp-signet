import { describe, test, expect } from "bun:test";
import { isContentTypeAllowed } from "../pipeline/content-type-filter.js";
import type { ContentTypeId } from "@xmtp-broker/schemas";

describe("isContentTypeAllowed", () => {
  test("returns true when content type is in allowlist", () => {
    const allowlist = new Set([
      "xmtp.org/text:1.0" as ContentTypeId,
      "xmtp.org/reaction:1.0" as ContentTypeId,
    ]);
    expect(
      isContentTypeAllowed("xmtp.org/text:1.0" as ContentTypeId, allowlist),
    ).toBe(true);
  });

  test("returns false when content type is not in allowlist", () => {
    const allowlist = new Set(["xmtp.org/text:1.0" as ContentTypeId]);
    expect(
      isContentTypeAllowed("xmtp.org/reaction:1.0" as ContentTypeId, allowlist),
    ).toBe(false);
  });

  test("returns false for unknown content types (default-deny)", () => {
    const allowlist = new Set(["xmtp.org/text:1.0" as ContentTypeId]);
    expect(
      isContentTypeAllowed(
        "custom.org/unknown:1.0" as ContentTypeId,
        allowlist,
      ),
    ).toBe(false);
  });

  test("returns false for empty allowlist", () => {
    const allowlist = new Set<ContentTypeId>();
    expect(
      isContentTypeAllowed("xmtp.org/text:1.0" as ContentTypeId, allowlist),
    ).toBe(false);
  });
});
