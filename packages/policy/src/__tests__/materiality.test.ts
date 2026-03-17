import { describe, test, expect } from "bun:test";
import { isMaterialChange, requiresReauthorization } from "../materiality.js";
import type { PolicyDelta } from "@xmtp-broker/contracts";

function emptyDelta(): PolicyDelta {
  return {
    viewChanges: [],
    grantChanges: [],
    contentTypeChanges: { added: [], removed: [] },
  };
}

describe("isMaterialChange", () => {
  test("accepts an array of deltas", () => {
    const deltas: readonly PolicyDelta[] = [
      {
        ...emptyDelta(),
        viewChanges: [{ field: "view.mode", from: "redacted", to: "full" }],
      },
      emptyDelta(),
    ];
    expect(isMaterialChange(deltas)).toBe(true);
  });

  test("returns false for array of empty deltas", () => {
    expect(isMaterialChange([emptyDelta(), emptyDelta()])).toBe(false);
  });

  test("view.mode change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [{ field: "view.mode", from: "redacted", to: "full" }],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("view.threadScopes change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [
        {
          field: "view.threadScopes",
          from: [{ groupId: "g1", threadId: null }],
          to: [
            { groupId: "g1", threadId: null },
            { groupId: "g2", threadId: null },
          ],
        },
      ],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("grant.messaging.send change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [{ field: "grant.messaging.send", from: false, to: true }],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("grant.egress change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.egress.storeExcerpts", from: false, to: true },
      ],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("grant.groupManagement change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.groupManagement.addMembers", from: false, to: true },
      ],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("grant.tools.scopes change is material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.tools.scopes", from: [], to: [{ toolId: "x" }] },
      ],
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("content type additions are material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      contentTypeChanges: { added: ["xmtp.org/text:1.0"], removed: [] },
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("content type removals are material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      contentTypeChanges: { added: [], removed: ["xmtp.org/text:1.0"] },
    };
    expect(isMaterialChange([delta])).toBe(true);
  });

  test("empty delta (session rotation) is not material", () => {
    expect(isMaterialChange([emptyDelta()])).toBe(false);
  });

  test("routine field changes are not material", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [{ field: "session.heartbeatInterval", from: 30, to: 60 }],
    };
    expect(isMaterialChange([delta])).toBe(false);
  });
});

describe("requiresReauthorization", () => {
  test("view.mode escalation requires reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [{ field: "view.mode", from: "redacted", to: "full" }],
    };
    expect(requiresReauthorization([delta])).toBe(true);
  });

  test("view.mode reduction does not require reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [{ field: "view.mode", from: "full", to: "redacted" }],
    };
    expect(requiresReauthorization([delta])).toBe(false);
  });

  test("grant escalation (false to true) requires reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.egress.forwardToProviders", from: false, to: true },
      ],
    };
    expect(requiresReauthorization([delta])).toBe(true);
  });

  test("grant reduction (true to false) does not require reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [{ field: "grant.messaging.send", from: true, to: false }],
    };
    expect(requiresReauthorization([delta])).toBe(false);
  });

  test("draftOnly guardrails do not count as false-to-true escalation", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.messaging.draftOnly", from: false, to: true },
      ],
    };
    expect(requiresReauthorization([delta])).toBe(false);
  });

  test("groupManagement escalation requires reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        { field: "grant.groupManagement.removeMembers", from: false, to: true },
      ],
    };
    expect(requiresReauthorization([delta])).toBe(true);
  });

  test("mode ordering: reveal-only < summary-only < redacted < thread-only < full", () => {
    // reveal-only -> summary-only is escalation
    const d1: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [
        { field: "view.mode", from: "reveal-only", to: "summary-only" },
      ],
    };
    expect(requiresReauthorization([d1])).toBe(true);

    // summary-only -> redacted is escalation
    const d2: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [
        { field: "view.mode", from: "summary-only", to: "redacted" },
      ],
    };
    expect(requiresReauthorization([d2])).toBe(true);

    // full -> reveal-only is reduction
    const d3: PolicyDelta = {
      ...emptyDelta(),
      viewChanges: [{ field: "view.mode", from: "full", to: "reveal-only" }],
    };
    expect(requiresReauthorization([d3])).toBe(false);
  });

  test("empty delta does not require reauthorization", () => {
    expect(requiresReauthorization([emptyDelta()])).toBe(false);
  });

  test("accepts an array of deltas and returns true if any requires reauth", () => {
    const deltas: readonly PolicyDelta[] = [
      emptyDelta(),
      {
        ...emptyDelta(),
        grantChanges: [
          { field: "grant.egress.forwardToProviders", from: false, to: true },
        ],
      },
    ];
    expect(requiresReauthorization(deltas)).toBe(true);
  });

  test("tool scope additions modeled as array diffs require reauthorization", () => {
    const delta: PolicyDelta = {
      ...emptyDelta(),
      grantChanges: [
        {
          field: "grant.tools.scopes",
          from: [{ toolId: "tool-1", allowed: false }],
          to: [{ toolId: "tool-1", allowed: true }],
        },
      ],
    };
    expect(requiresReauthorization([delta])).toBe(true);
  });
});
