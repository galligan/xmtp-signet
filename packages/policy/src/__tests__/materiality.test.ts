import { describe, expect, test } from "bun:test";
import { isMaterialChange, requiresReauthorization } from "../materiality.js";
import type { PolicyDelta } from "@xmtp/signet-contracts";

function emptyDelta(): PolicyDelta {
  return {
    added: [],
    removed: [],
    changed: [],
  };
}

describe("isMaterialChange", () => {
  test("returns true when scopes are added", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      added: ["send"],
    };
    expect(isMaterialChange(delta)).toBe(true);
  });

  test("returns true when scopes are removed", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      removed: ["send"],
    };
    expect(isMaterialChange(delta)).toBe(true);
  });

  test("returns true when scopes are changed", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      changed: [{ scope: "send", from: "deny", to: "allow" }],
    };
    expect(isMaterialChange(delta)).toBe(true);
  });

  test("returns false for empty delta", () => {
    expect(isMaterialChange(emptyDelta())).toBe(false);
  });

  test("accepts an array of deltas", () => {
    const deltas: readonly PolicyDelta[] = [
      emptyDelta(),
      {
        ...emptyDelta(),
        added: ["send"],
      },
    ];
    expect(isMaterialChange(deltas)).toBe(true);
  });
});

describe("requiresReauthorization", () => {
  test("adding scopes requires reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      added: ["send", "reply"],
    };
    expect(requiresReauthorization(delta)).toBe(true);
  });

  test("removing scopes does not require reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      removed: ["send"],
    };
    expect(requiresReauthorization(delta)).toBe(false);
  });

  test("changing scope from deny to allow requires reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      changed: [{ scope: "forward-to-provider", from: "deny", to: "allow" }],
    };
    expect(requiresReauthorization(delta)).toBe(true);
  });

  test("changing scope from allow to deny does not require reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      changed: [{ scope: "send", from: "allow", to: "deny" }],
    };
    expect(requiresReauthorization(delta)).toBe(false);
  });

  test("empty delta does not require reauthorization", () => {
    expect(requiresReauthorization(emptyDelta())).toBe(false);
  });

  test("accepts an array of deltas and returns true if any requires reauth", () => {
    const deltas: readonly PolicyDelta[] = [
      emptyDelta(),
      {
        ...emptyDelta(),
        changed: [{ scope: "forward-to-provider", from: "deny", to: "allow" }],
      },
    ];
    expect(requiresReauthorization(deltas)).toBe(true);
  });
});
