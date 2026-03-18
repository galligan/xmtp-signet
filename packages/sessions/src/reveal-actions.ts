import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, SessionManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  RevealGrant,
  RevealScope as RevealScopeType,
} from "@xmtp/signet-schemas";
import { RevealScope, PermissionError } from "@xmtp/signet-schemas";
import type { RevealStateSnapshot } from "@xmtp/signet-contracts";

/** Dependencies for reveal action registration. */
export interface RevealActionDeps {
  readonly sessionManager: SessionManager;
}

interface RevealRequestInput {
  readonly sessionId: string;
  readonly groupId: string;
  readonly scope: RevealScopeType;
  readonly targetId: string;
  readonly requestedBy: string;
  readonly expiresAt: string | null;
}

const RevealRequestInput = z.object({
  sessionId: z.string(),
  groupId: z.string(),
  scope: RevealScope,
  targetId: z.string(),
  requestedBy: z.string(),
  expiresAt: z.string().datetime().nullable(),
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI and MCP actions for content reveal workflows. */
export function createRevealActions(
  deps: RevealActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const request: ActionSpec<RevealRequestInput, RevealGrant, SignetError> = {
    id: "reveal.request",
    input: RevealRequestInput,
    handler: async (input) => {
      // Look up the session to validate scope
      const sessionResult = await deps.sessionManager.lookup(input.sessionId);
      if (Result.isError(sessionResult)) {
        return sessionResult;
      }

      const session = sessionResult.value;

      // Reject non-active sessions
      if (session.state !== "active") {
        return Result.err(
          PermissionError.create(
            `Session is ${session.state} — reveal requests require an active session`,
            { sessionId: input.sessionId, state: session.state },
          ),
        );
      }

      // Validate groupId is within the session's view.threadScopes
      const matchingScopes = session.view.threadScopes.filter(
        (scope) => scope.groupId === input.groupId,
      );
      if (matchingScopes.length === 0) {
        return Result.err(
          PermissionError.create(
            "Group is not within the session's thread scopes",
            {
              sessionId: input.sessionId,
              groupId: input.groupId,
            },
          ),
        );
      }

      // For thread-scoped reveals, verify the target thread is allowed
      if (input.scope === "thread" && input.targetId) {
        const threadAllowed = matchingScopes.some(
          (scope) =>
            scope.threadId === null || scope.threadId === input.targetId,
        );
        if (!threadAllowed) {
          return Result.err(
            PermissionError.create(
              "Thread is not within the session's thread scopes",
              {
                sessionId: input.sessionId,
                groupId: input.groupId,
                threadId: input.targetId,
              },
            ),
          );
        }
      }

      // Get or create the reveal state store for this session
      const storeResult = deps.sessionManager.getRevealState(input.sessionId);
      if (Result.isError(storeResult)) {
        return storeResult;
      }

      const store = storeResult.value;
      const revealId = crypto.randomUUID();
      const grantedAt = new Date().toISOString();

      const grant: RevealGrant = {
        revealId,
        grantedAt,
        grantedBy: input.requestedBy,
        expiresAt: input.expiresAt,
      };

      const revealRequest = {
        revealId,
        groupId: input.groupId,
        scope: input.scope,
        targetId: input.targetId,
        requestedBy: input.requestedBy,
        expiresAt: input.expiresAt,
      };

      store.grant(grant, revealRequest);

      return Result.ok(grant);
    },
    cli: {
      command: "reveal:request",
      rpcMethod: "reveal.request",
    },
    mcp: {
      toolName: "signet/reveal/request",
      description: "Request content to be revealed to an agent session",
      readOnly: false,
    },
  };

  const list: ActionSpec<
    { sessionId: string },
    RevealStateSnapshot,
    SignetError
  > = {
    id: "reveal.list",
    input: z.object({
      sessionId: z.string(),
    }),
    handler: async (input) => {
      const storeResult = deps.sessionManager.getRevealState(input.sessionId);
      if (Result.isError(storeResult)) {
        return storeResult;
      }
      return Result.ok(storeResult.value.snapshot());
    },
    cli: {
      command: "reveal:list",
      rpcMethod: "reveal.list",
    },
    mcp: {
      toolName: "signet/reveal/list",
      description: "List active reveals for a session",
      readOnly: true,
    },
  };

  return [widenActionSpec(request), widenActionSpec(list)];
}
