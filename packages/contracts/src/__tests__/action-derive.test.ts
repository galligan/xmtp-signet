import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { Ok } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { ActionSpec } from "../action-spec.js";
import {
  deriveCliCommand,
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpPath,
  deriveMcpAnnotations,
  deriveMcpToolName,
  deriveRpcMethod,
} from "../action-derive.js";
import type { HandlerContext } from "../handler-types.js";

function createTestSpec(
  id: string,
  overrides?: Partial<ActionSpec<unknown, unknown, SignetError>>,
): ActionSpec<unknown, unknown, SignetError> {
  return {
    id,
    input: z.object({}),
    handler: async (_input: unknown, _ctx: HandlerContext) => new Ok(undefined),
    ...overrides,
  };
}

describe("action derivation helpers", () => {
  it("derives a CLI command from the action id", () => {
    expect(deriveCliCommand(createTestSpec("credential.list"))).toBe(
      "credential:list",
    );
  });

  it("uses an authored CLI command override when present", () => {
    expect(
      deriveCliCommand(
        createTestSpec("credential.list", {
          cli: {
            command: "credential:ls",
          },
        }),
      ),
    ).toBe("credential:ls");
  });

  it("derives the RPC method from the action id", () => {
    expect(deriveRpcMethod(createTestSpec("credential.list"))).toBe(
      "credential.list",
    );
  });

  it("derives an MCP tool name from the action id", () => {
    expect(deriveMcpToolName(createTestSpec("credential.list"))).toBe(
      "signet/credential/list",
    );
  });

  it("uses an authored MCP tool name override when present", () => {
    expect(
      deriveMcpToolName(
        createTestSpec("credential.list", {
          mcp: {
            toolName: "signet/credential/ls",
          },
        }),
      ),
    ).toBe("signet/credential/ls");
  });

  it("derives MCP annotations from intent, idempotency, and description", () => {
    expect(
      deriveMcpAnnotations(
        createTestSpec("credential.list", {
          description: "List credentials",
          intent: "read",
          idempotent: true,
          mcp: {
            annotations: {
              openWorldHint: true,
            },
          },
        }),
      ),
    ).toEqual({
      idempotentHint: true,
      openWorldHint: true,
      readOnlyHint: true,
      title: "List credentials",
    });
  });

  it("derives HTTP methods from intent", () => {
    expect(
      deriveHttpMethod(createTestSpec("credential.list", { intent: "read" })),
    ).toBe("GET");
    expect(
      deriveHttpMethod(createTestSpec("credential.issue", { intent: "write" })),
    ).toBe("POST");
    expect(
      deriveHttpMethod(
        createTestSpec("credential.revoke", { intent: "destroy" }),
      ),
    ).toBe("DELETE");
  });

  it("uses an authored HTTP method override when present", () => {
    expect(
      deriveHttpMethod(
        createTestSpec("credential.list", {
          intent: "read",
          http: {
            auth: "admin",
            method: "POST",
          },
        }),
      ),
    ).toBe("POST");
  });

  it("derives an HTTP path from the action id", () => {
    expect(deriveHttpPath(createTestSpec("credential.list"))).toBe(
      "/v1/actions/credential/list",
    );
  });

  it("uses an authored HTTP path override when present", () => {
    expect(
      deriveHttpPath(
        createTestSpec("credential.list", {
          http: {
            auth: "admin",
            path: "/v1/agent/actions/credential/list",
          },
        }),
      ),
    ).toBe("/v1/agent/actions/credential/list");
  });

  it("derives HTTP input sources from the HTTP method", () => {
    expect(deriveHttpInputSource("GET")).toBe("query");
    expect(deriveHttpInputSource("POST")).toBe("body");
    expect(deriveHttpInputSource("DELETE")).toBe("body");
  });
});
