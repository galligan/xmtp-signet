import { describe, expect, test } from "bun:test";
import { Result } from "better-result";
import { z } from "zod";
import {
  createActionRegistry,
  type ActionSpec,
  type HandlerContext,
} from "@xmtp/signet-contracts";
import { buildHttpActionRoutes } from "../http/action-routes.js";

function makeSpec(
  id: string,
  overrides?: Partial<ActionSpec<unknown, unknown>>,
): ActionSpec<unknown, unknown> {
  return {
    id,
    input: z.object({}).passthrough(),
    handler: async (_input: unknown, _ctx: HandlerContext) =>
      Result.ok(undefined),
    ...overrides,
  };
}

describe("buildHttpActionRoutes", () => {
  test("derives method, path, and input source from the shared action contract", () => {
    const registry = createActionRegistry();
    registry.register(
      makeSpec("credential.list", {
        description: "List credentials",
        intent: "read",
        http: {
          auth: "admin",
        },
      }),
    );

    const result = buildHttpActionRoutes(registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toEqual([
      expect.objectContaining({
        actionId: "credential.list",
        auth: "admin",
        inputSource: "query",
        method: "GET",
        path: "/v1/actions/credential/list",
      }),
    ]);
  });

  test("omits actions that are explicitly hidden from the HTTP surface", () => {
    const registry = createActionRegistry();
    registry.register(
      makeSpec("credential.list", {
        intent: "read",
        http: {
          auth: "admin",
          expose: false,
        },
      }),
    );

    const result = buildHttpActionRoutes(registry);

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toHaveLength(0);
  });
});
