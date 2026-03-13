import { describe, test, expect } from "bun:test";
import { validateEgress } from "../grant/validate-egress.js";
import { Result } from "better-result";
import { createFullGrant, createDenyAllGrant } from "./fixtures.js";

describe("validateEgress", () => {
  const actions = [
    "storeExcerpts",
    "useForMemory",
    "forwardToProviders",
    "quoteRevealed",
    "summarize",
  ] as const;

  for (const action of actions) {
    test(`succeeds when egress.${action} is true`, () => {
      const result = validateEgress(action, createFullGrant());
      expect(Result.isOk(result)).toBe(true);
    });

    test(`returns GrantDeniedError when egress.${action} is false`, () => {
      const result = validateEgress(action, createDenyAllGrant());
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error._tag).toBe("GrantDeniedError");
      }
    });
  }
});
