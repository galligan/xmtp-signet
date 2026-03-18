import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, SessionManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  SessionConfig as SessionConfigType,
  SessionRevocationReason as SessionRevocationReasonType,
} from "@xmtp/signet-schemas";
import { SessionConfig, SessionRevocationReason } from "@xmtp/signet-schemas";

/** Dependencies for session action registration. */
export interface SessionActionDeps {
  readonly sessionManager: SessionManager;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  // The shared registry intentionally erases per-action input/output types.
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI and MCP actions for session lifecycle operations. */
export function createSessionActions(
  deps: SessionActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const issue: ActionSpec<SessionConfigType, unknown, SignetError> = {
    id: "session.issue",
    input: SessionConfig,
    handler: async (input) => deps.sessionManager.issue(input),
    cli: {
      command: "session:issue",
      rpcMethod: "session.issue",
    },
    mcp: {
      toolName: "signet/session/issue",
      description: "Issue a new session",
      readOnly: false,
    },
  };

  const list: ActionSpec<
    { agentInboxId?: string | undefined },
    unknown,
    SignetError
  > = {
    id: "session.list",
    input: z.object({
      agentInboxId: z.string().optional(),
    }),
    handler: async (input) => deps.sessionManager.list(input.agentInboxId),
    cli: {
      command: "session:list",
      rpcMethod: "session.list",
    },
    mcp: {
      toolName: "signet/session/list",
      description: "List active sessions",
      readOnly: true,
    },
  };

  const inspect: ActionSpec<{ sessionId: string }, unknown, SignetError> = {
    id: "session.inspect",
    input: z.object({
      sessionId: z.string(),
    }),
    handler: async (input) => deps.sessionManager.lookup(input.sessionId),
    cli: {
      command: "session:inspect",
      rpcMethod: "session.inspect",
    },
    mcp: {
      toolName: "signet/session/inspect",
      description: "Inspect a session",
      readOnly: true,
    },
  };

  const revoke: ActionSpec<
    { sessionId: string; reason?: SessionRevocationReasonType | undefined },
    { revoked: true },
    SignetError
  > = {
    id: "session.revoke",
    input: z.object({
      sessionId: z.string(),
      reason: SessionRevocationReason.default("owner-initiated"),
    }),
    handler: async (input) => {
      const result = await deps.sessionManager.revoke(
        input.sessionId,
        input.reason ?? "owner-initiated",
      );
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok({ revoked: true as const });
    },
    cli: {
      command: "session:revoke",
      rpcMethod: "session.revoke",
    },
    mcp: {
      toolName: "signet/session/revoke",
      description: "Revoke a session",
      readOnly: false,
      destructive: true,
    },
  };

  return [
    widenActionSpec(issue),
    widenActionSpec(list),
    widenActionSpec(inspect),
    widenActionSpec(revoke),
  ];
}
