import { describe, test, expect } from "bun:test";
import { projectContent } from "../pipeline/content-projector.js";
import type { ContentTypeId } from "@xmtp/signet-schemas";

describe("projectContent", () => {
  const content = { text: "hello world" };
  const contentType = "xmtp.org/text:1.0" as ContentTypeId;

  test("visible passes content through unchanged", () => {
    expect(projectContent(content, contentType, "visible")).toEqual(content);
  });

  test("historical passes content through unchanged", () => {
    expect(projectContent(content, contentType, "historical")).toEqual(content);
  });

  test("revealed passes content through unchanged", () => {
    expect(projectContent(content, contentType, "revealed")).toEqual(content);
  });

  test("redacted replaces content with null", () => {
    expect(projectContent(content, contentType, "redacted")).toBeNull();
  });

  test("hidden is unreachable but returns null defensively", () => {
    expect(projectContent(content, contentType, "hidden")).toBeNull();
  });
});
