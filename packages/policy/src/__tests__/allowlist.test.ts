import { describe, test, expect } from "bun:test";
import { resolveEffectiveAllowlist } from "../allowlist.js";
import { BASELINE_CONTENT_TYPES } from "@xmtp-broker/schemas";
import type { ContentTypeId } from "@xmtp-broker/schemas";
import { Result } from "better-result";

describe("resolveEffectiveAllowlist", () => {
  test("intersection of all three tiers", () => {
    const broker = {
      allowlist: new Set([
        "xmtp.org/text:1.0" as ContentTypeId,
        "xmtp.org/reaction:1.0" as ContentTypeId,
        "xmtp.org/reply:1.0" as ContentTypeId,
      ]),
    };
    const agent = [
      "xmtp.org/text:1.0" as ContentTypeId,
      "xmtp.org/reaction:1.0" as ContentTypeId,
    ];

    const result = resolveEffectiveAllowlist(
      BASELINE_CONTENT_TYPES,
      broker,
      agent,
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.size).toBe(2);
      expect(result.value.has("xmtp.org/text:1.0" as ContentTypeId)).toBe(true);
      expect(result.value.has("xmtp.org/reaction:1.0" as ContentTypeId)).toBe(
        true,
      );
    }
  });

  test("broker superset of baseline still bounded by baseline", () => {
    const broker = {
      allowlist: new Set([
        ...BASELINE_CONTENT_TYPES,
        "custom.org/special:1.0" as ContentTypeId,
      ]),
    };
    const agent = [
      ...BASELINE_CONTENT_TYPES,
      "custom.org/special:1.0" as ContentTypeId,
    ];

    const result = resolveEffectiveAllowlist(
      BASELINE_CONTENT_TYPES,
      broker,
      agent,
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.size).toBe(BASELINE_CONTENT_TYPES.length);
      expect(result.value.has("custom.org/special:1.0" as ContentTypeId)).toBe(
        false,
      );
    }
  });

  test("agent requests types broker does not allow -- silently excluded", () => {
    const broker = {
      allowlist: new Set(["xmtp.org/text:1.0" as ContentTypeId]),
    };
    const agent = [
      "xmtp.org/text:1.0" as ContentTypeId,
      "xmtp.org/reaction:1.0" as ContentTypeId,
    ];

    const result = resolveEffectiveAllowlist(
      BASELINE_CONTENT_TYPES,
      broker,
      agent,
    );
    expect(Result.isOk(result)).toBe(true);
    if (Result.isOk(result)) {
      expect(result.value.size).toBe(1);
      expect(result.value.has("xmtp.org/text:1.0" as ContentTypeId)).toBe(true);
    }
  });

  test("empty intersection returns ValidationError", () => {
    const broker = {
      allowlist: new Set(["xmtp.org/text:1.0" as ContentTypeId]),
    };
    const agent = ["xmtp.org/reaction:1.0" as ContentTypeId];

    const result = resolveEffectiveAllowlist(
      BASELINE_CONTENT_TYPES,
      broker,
      agent,
    );
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("ValidationError");
    }
  });

  test("empty agent allowlist returns ValidationError", () => {
    const broker = {
      allowlist: new Set(BASELINE_CONTENT_TYPES),
    };
    const result = resolveEffectiveAllowlist(
      BASELINE_CONTENT_TYPES,
      broker,
      [],
    );
    expect(Result.isError(result)).toBe(true);
  });
});
