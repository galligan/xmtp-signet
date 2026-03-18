/**
 * Session permission update actions.
 *
 * Allows modifying a session's view or grant in-place without
 * revoke + reissue. Non-material changes (narrowing scope) apply
 * immediately. Material escalations trigger reauthorization.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, SessionManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  ViewConfig as ViewConfigType,
  GrantConfig as GrantConfigType,
} from "@xmtp/signet-schemas";
import { AuthError, ViewConfig, GrantConfig } from "@xmtp/signet-schemas";
import type { InternalSessionManager } from "./session-manager.js";

/** Dependencies for session update actions. */
export interface UpdateActionDeps {
  readonly sessionManager: SessionManager;
  readonly internalManager: InternalSessionManager;
}

/** Result shape for update operations. */
interface UpdateResult {
  readonly updated: boolean;
  readonly material: boolean;
  readonly reason: string | null;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI and MCP actions for in-place session updates. */
export function createUpdateActions(
  deps: UpdateActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const updateView: ActionSpec<
    { sessionId: string; view: ViewConfigType },
    UpdateResult,
    SignetError
  > = {
    id: "session.updateView",
    input: z.object({
      sessionId: z.string(),
      view: ViewConfig,
    }),
    handler: async (input) => {
      const lookupResult = await deps.sessionManager.lookup(input.sessionId);
      if (Result.isError(lookupResult)) {
        return lookupResult;
      }

      const session = lookupResult.value;
      if (session.state !== "active") {
        return Result.err(
          AuthError.create("Session is not active", {
            sessionId: input.sessionId,
            state: session.state,
          }),
        );
      }

      const materialityResult = deps.internalManager.checkMateriality(
        input.sessionId,
        input.view,
        session.grant,
      );
      if (Result.isError(materialityResult)) {
        return materialityResult;
      }

      const check = materialityResult.value;

      if (check.isMaterial) {
        deps.internalManager.setSessionState(
          input.sessionId,
          "reauthorization-required",
        );
        return Result.ok({
          updated: false,
          material: true,
          reason: check.reason,
        });
      }

      const updateResult = deps.internalManager.updateSessionPolicy(
        input.sessionId,
        input.view,
        session.grant,
      );
      if (Result.isError(updateResult)) {
        return updateResult;
      }

      return Result.ok({ updated: true, material: false, reason: null });
    },
    cli: {
      command: "session:update-view",
      rpcMethod: "session.updateView",
    },
    mcp: {
      toolName: "signet/session/update-view",
      description: "Update a session's view configuration",
      readOnly: false,
    },
  };

  const updateGrant: ActionSpec<
    { sessionId: string; grant: GrantConfigType },
    UpdateResult,
    SignetError
  > = {
    id: "session.updateGrant",
    input: z.object({
      sessionId: z.string(),
      grant: GrantConfig,
    }),
    handler: async (input) => {
      const lookupResult = await deps.sessionManager.lookup(input.sessionId);
      if (Result.isError(lookupResult)) {
        return lookupResult;
      }

      const session = lookupResult.value;
      if (session.state !== "active") {
        return Result.err(
          AuthError.create("Session is not active", {
            sessionId: input.sessionId,
            state: session.state,
          }),
        );
      }

      const materialityResult = deps.internalManager.checkMateriality(
        input.sessionId,
        session.view,
        input.grant,
      );
      if (Result.isError(materialityResult)) {
        return materialityResult;
      }

      const check = materialityResult.value;

      if (check.isMaterial) {
        deps.internalManager.setSessionState(
          input.sessionId,
          "reauthorization-required",
        );
        return Result.ok({
          updated: false,
          material: true,
          reason: check.reason,
        });
      }

      const updateResult = deps.internalManager.updateSessionPolicy(
        input.sessionId,
        session.view,
        input.grant,
      );
      if (Result.isError(updateResult)) {
        return updateResult;
      }

      return Result.ok({ updated: true, material: false, reason: null });
    },
    cli: {
      command: "session:update-grant",
      rpcMethod: "session.updateGrant",
    },
    mcp: {
      toolName: "signet/session/update-grant",
      description: "Update a session's grant configuration",
      readOnly: false,
    },
  };

  return [widenActionSpec(updateView), widenActionSpec(updateGrant)];
}
