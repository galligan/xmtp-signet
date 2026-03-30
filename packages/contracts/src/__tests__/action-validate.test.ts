import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Ok } from "better-result";
import type { ActionSpec, HttpSurface, McpSurface } from "../action-spec.js";
import { validateActionSpecs } from "../action-validate.js";
import type { HandlerContext } from "../handler-types.js";

function createTestSpec(
  id: string,
  overrides?: Partial<ActionSpec<unknown, unknown>>,
): ActionSpec<unknown, unknown> {
  return {
    id,
    input: z.object({}),
    handler: async (_input: unknown, _ctx: HandlerContext) => new Ok(undefined),
    ...overrides,
  };
}

describe("validateActionSpecs", () => {
  it("accepts structurally valid action specs", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list", {
        description: "List credentials",
        intent: "read",
        idempotent: true,
        cli: {},
        mcp: {},
        http: {
          auth: "admin",
        },
      }),
      createTestSpec("credential.issue", {
        intent: "write",
        cli: {},
      }),
    ]);

    expect(result.isOk()).toBe(true);
  });

  it("reports duplicate action ids", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list"),
      createTestSpec("credential.list"),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "credential.list",
            rule: "unique-action-id",
          }),
        ]),
      );
    }
  });

  it("reports derived HTTP route collisions", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list", {
        intent: "read",
        http: {
          auth: "admin",
        },
      }),
      createTestSpec("credential.lookup", {
        intent: "read",
        http: {
          auth: "admin",
          path: "/v1/actions/credential/list",
        },
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "credential.lookup",
            rule: "unique-http-route",
          }),
        ]),
      );
    }
  });

  it("reports exposed HTTP actions missing auth", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list", {
        http: {
          expose: true,
        } as HttpSurface,
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "credential.list",
            rule: "http-auth-required",
          }),
        ]),
      );
    }
  });

  it("reports reserved HTTP route collisions with built-in namespaces", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list", {
        intent: "read",
        http: {
          auth: "admin",
          path: "/v1/admin/credential.list",
        },
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "credential.list",
            rule: "reserved-http-route",
          }),
        ]),
      );
    }
  });

  it("reports reserved HTTP route collisions with built-in paths", () => {
    const result = validateActionSpecs([
      createTestSpec("signet.health-shadow", {
        intent: "read",
        http: {
          auth: "admin",
          path: "/v1/health",
        },
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "signet.health-shadow",
            rule: "reserved-http-route",
          }),
        ]),
      );
    }
  });

  it("reports contradictory authored MCP annotations", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.list", {
        description: "List credentials",
        intent: "read",
        idempotent: true,
        mcp: {
          annotations: {
            destructiveHint: true,
            idempotentHint: false,
            readOnlyHint: false,
            title: "Something else",
          },
        } as McpSurface,
      }),
    ]);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.context.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actionId: "credential.list",
            rule: "mcp-annotation-consistency",
          }),
        ]),
      );
    }
  });

  it("allows explicit false boolean MCP hints when the derived hint is omitted", () => {
    const result = validateActionSpecs([
      createTestSpec("credential.issue", {
        description: "Issue a credential",
        intent: "write",
        mcp: {
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
          },
        } as McpSurface,
      }),
    ]);

    expect(result.isOk()).toBe(true);
  });
});
