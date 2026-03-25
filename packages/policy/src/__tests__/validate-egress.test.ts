import { describe, test, expect } from "bun:test";
import { validateEgress } from "../permissions/validate-egress.js";
import { Result } from "better-result";
import { createFullScopes, createEmptyScopes } from "./fixtures.js";

describe("validateEgress", () => {
  const scopeNames = [
    "store-excerpts",
    "use-for-memory",
    "forward-to-provider",
    "quote-revealed",
    "summarize",
  ] as const;

  for (const scope of scopeNames) {
    test(`succeeds when ${scope} scope is allowed`, () => {
      const result = validateEgress(scope, createFullScopes());
      expect(Result.isOk(result)).toBe(true);
    });

    test(`returns PermissionError when ${scope} scope is denied`, () => {
      const result = validateEgress(scope, createEmptyScopes());
      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) {
        expect(result.error._tag).toBe("PermissionError");
      }
    });
  }
});
