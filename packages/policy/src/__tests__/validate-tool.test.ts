import { describe, test, expect } from "bun:test";
import { validateToolUse } from "../grant/validate-tool.js";
import { Result } from "better-result";
import { createFullGrant } from "./fixtures.js";
import type { GrantConfig } from "@xmtp/signet-schemas";

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
  });

  test("returns GrantDeniedError when allowed: false", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [{ toolId: "web-search", allowed: false, parameters: null }],
      },
    };
    const result = validateToolUse("web-search", null, grant);
    expect(Result.isError(result)).toBe(true);
  });

  test("succeeds with null parameters (unconstrained)", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [{ toolId: "web-search", allowed: true, parameters: null }],
      },
    };
    const result = validateToolUse("web-search", { anything: "goes" }, grant);
    expect(Result.isOk(result)).toBe(true);
  });

  test("succeeds when request params match constraints", () => {
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
    const result = validateToolUse("web-search", { maxResults: 10 }, grant);
    expect(Result.isOk(result)).toBe(true);
  });

  test("fails when constrained value does not match", () => {
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
    expect(Result.isError(result)).toBe(true);
  });

  test("allows omitting optional constrained keys", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [
          {
            toolId: "web-search",
            allowed: true,
            parameters: { region: "us", maxResults: 10 },
          },
        ],
      },
    };
    // Only send region, omit maxResults — allowed
    const result = validateToolUse("web-search", { region: "us" }, grant);
    expect(Result.isOk(result)).toBe(true);
  });

  test("rejects extra keys not in constraints (allowlist)", () => {
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
    const result = validateToolUse(
      "web-search",
      { maxResults: 10, includePrivate: true },
      grant,
    );
    expect(Result.isError(result)).toBe(true);
  });

  test("enforces null constraint values", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [
          { toolId: "api", allowed: true, parameters: { cursor: null } },
        ],
      },
    };
    expect(
      Result.isError(validateToolUse("api", { cursor: "abc" }, grant)),
    ).toBe(true);
    expect(Result.isOk(validateToolUse("api", { cursor: null }, grant))).toBe(
      true,
    );
  });

  test("enforces nested object constraints", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [
          {
            toolId: "search",
            allowed: true,
            parameters: { filters: { region: "us" } },
          },
        ],
      },
    };
    expect(
      Result.isError(
        validateToolUse("search", { filters: { region: "eu" } }, grant),
      ),
    ).toBe(true);
    expect(
      Result.isOk(
        validateToolUse("search", { filters: { region: "us" } }, grant),
      ),
    ).toBe(true);
  });

  test("allows no params when constraints exist (all optional)", () => {
    const grant: GrantConfig = {
      ...createFullGrant(),
      tools: {
        scopes: [
          {
            toolId: "calendar",
            allowed: true,
            parameters: { scope: "read-only" },
          },
        ],
      },
    };
    const result = validateToolUse("calendar", null, grant);
    expect(Result.isOk(result)).toBe(true);
  });
});
