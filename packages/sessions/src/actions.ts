import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, SessionManager } from "@xmtp-broker/contracts";
import type {
  BrokerError,
  SessionConfig as SessionConfigType,
  SessionRevocationReason as SessionRevocationReasonType,
} from "@xmtp-broker/schemas";
import { SessionConfig, SessionRevocationReason } from "@xmtp-broker/schemas";

export interface SessionActionDeps {
  readonly sessionManager: SessionManager;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, BrokerError>,
): ActionSpec<unknown, unknown, BrokerError> {
  // The shared registry intentionally erases per-action input/output types.
  return spec as ActionSpec<unknown, unknown, BrokerError>;
}

export function createSessionActions(
  deps: SessionActionDeps,
): ActionSpec<unknown, unknown, BrokerError>[] {
  const issue: ActionSpec<SessionConfigType, unknown, BrokerError> = {
    id: "session.issue",
    input: SessionConfig,
    handler: async (input) => deps.sessionManager.issue(input),
    cli: {
      command: "session:issue",
      rpcMethod: "session.issue",
    },
    mcp: {
      toolName: "broker/session/issue",
      description: "Issue a new session",
      readOnly: false,
    },
  };

  const list: ActionSpec<
    { agentInboxId?: string | undefined },
    unknown,
    BrokerError
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
      toolName: "broker/session/list",
      description: "List active sessions",
      readOnly: true,
    },
  };

  const inspect: ActionSpec<{ sessionId: string }, unknown, BrokerError> = {
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
      toolName: "broker/session/inspect",
      description: "Inspect a session",
      readOnly: true,
    },
  };

  const revoke: ActionSpec<
    { sessionId: string; reason?: SessionRevocationReasonType | undefined },
    { revoked: true },
    BrokerError
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
      toolName: "broker/session/revoke",
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
