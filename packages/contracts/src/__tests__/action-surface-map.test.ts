import { describe, expect, test } from "bun:test";
import { Ok } from "better-result";
import { z } from "zod";
import {
  hashActionSurfaceMap,
  generateActionSurfaceMap,
} from "../action-surface-map.js";
import type { ActionSpec } from "../action-spec.js";
import type { HandlerContext } from "../handler-types.js";

function makeSpec(
  id: string,
  overrides?: Partial<ActionSpec<unknown, unknown>>,
): ActionSpec<unknown, unknown> {
  return {
    id,
    input: z.object({}).passthrough(),
    handler: async (_input: unknown, _ctx: HandlerContext) => new Ok(undefined),
    ...overrides,
  };
}

describe("action surface map", () => {
  test("is deterministic regardless of spec registration order", () => {
    const a = makeSpec("credential.list", {
      description: "List credentials",
      intent: "read",
      idempotent: true,
      cli: {},
      http: {
        auth: "admin",
      },
    });
    const b = makeSpec("reveal.request", {
      description: "Request a reveal",
      mcp: {},
      http: {
        auth: "credential",
      },
    });

    const first = generateActionSurfaceMap([a, b]);
    const second = generateActionSurfaceMap([b, a]);

    expect(first.entries).toEqual(second.entries);
    expect(hashActionSurfaceMap(first)).toBe(hashActionSurfaceMap(second));
  });

  test("omits hidden HTTP surfaces from the public surface summary", () => {
    const surfaceMap = generateActionSurfaceMap([
      makeSpec("credential.list", {
        intent: "read",
        http: {
          auth: "admin",
          expose: false,
        },
        mcp: {},
      }),
    ]);

    expect(surfaceMap.entries).toHaveLength(1);
    expect(surfaceMap.entries[0]).toEqual(
      expect.objectContaining({
        id: "credential.list",
        surfaces: ["mcp"],
      }),
    );
    expect(surfaceMap.entries[0]).not.toHaveProperty("http");
  });
});
