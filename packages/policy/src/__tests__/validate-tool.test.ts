import { describe, test, expect } from "bun:test";
import { validateToolUse } from "../grant/validate-tool.js";
import { Result } from "better-result";
import { createFullGrant } from "./fixtures.js";
import type { GrantConfig } from "@xmtp-broker/schemas";

describe("validateToolUse", () => {
  test("succeeds when toolId is in scopes with allowed: true", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [{ toolId: "web-search", allowed: true, parameters: null }],
      },
    };
    const result = validateToolUse("web-search", null, grant);
    expect(Result.isOk(result)).toBe(true);
  });

  test("returns GrantDeniedError when toolId is not in scopes", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: { scopes: [] },
    };
    const result = validateToolUse("web-search", null, grant);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("GrantDeniedError");
    }
  });

  test("returns GrantDeniedError when toolId is in scopes but allowed: false", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [{ toolId: "web-search", allowed: false, parameters: null }],
      },
    };
    const result = validateToolUse("web-search", null, grant);
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error._tag).toBe("GrantDeniedError");
    }
  });

  test("succeeds when tool has parameter constraints and request params are provided", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [
          {
            toolId: "web-search",
            allowed: true,
            parameters: { maxResults: 10 },
          },
        ],
      },
    };
    const result = validateToolUse("web-search", { maxResults: 5 }, grant);
    expect(Result.isOk(result)).toBe(true);
  });

  test("succeeds when tool has null parameters (unconstrained)", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [{ toolId: "web-search", allowed: true, parameters: null }],
      },
    };
    const result = validateToolUse("web-search", { anything: "goes" }, grant);
    expect(Result.isOk(result)).toBe(true);
  });
});
