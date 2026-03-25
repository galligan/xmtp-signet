/**
 * Reveal actions for credential-scoped content reveals.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type { CredentialManager } from "@xmtp/signet-contracts";
import type {
  SignetError,
  RevealGrant,
  RevealScope as RevealScopeType,
} from "@xmtp/signet-schemas";
import { RevealScope, PermissionError } from "@xmtp/signet-schemas";
import type { RevealStateSnapshot } from "@xmtp/signet-contracts";
import type { InternalCredentialManager } from "./credential-manager.js";

/** Dependencies for reveal action registration. */
export interface RevealActionDeps {
  readonly credentialManager: CredentialManager;
  readonly internalManager: InternalCredentialManager;
}

interface RevealRequestInput {
  readonly credentialId: string;
  readonly chatId: string;
  readonly scope: RevealScopeType;
  readonly targetId: string;
  readonly requestedBy: string;
  readonly expiresAt: string | null;
}

const RevealRequestInput = z.object({
  credentialId: z.string(),
  chatId: z.string(),
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

function resolveCredentialTarget(
  requestedCredentialId: string,
  authenticatedCredentialId: string | undefined,
): Result<string, SignetError> {
  if (
    authenticatedCredentialId !== undefined &&
    authenticatedCredentialId !== requestedCredentialId
  ) {
    return Result.err(
      PermissionError.create(
        "Credential-scoped reveal actions may only target the authenticated credential",
        {
          authenticatedCredentialId,
          requestedCredentialId,
        },
      ),
    );
  }

  return Result.ok(requestedCredentialId);
}

/** Create CLI and MCP actions for content reveal workflows. */
export function createRevealActions(
  deps: RevealActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const request: ActionSpec<RevealRequestInput, RevealGrant, SignetError> = {
    id: "reveal.request",
    input: RevealRequestInput,
    handler: async (input, ctx) => {
      const targetResult = resolveCredentialTarget(
        input.credentialId,
        ctx.credentialId,
      );
      if (Result.isError(targetResult)) {
        return targetResult;
      }
      const targetCredentialId = targetResult.value;

      // Look up the credential to validate scope
      const credResult =
        await deps.credentialManager.lookup(targetCredentialId);
      if (Result.isError(credResult)) {
        return credResult;
      }

      const credential = credResult.value;

      // Reject non-active credentials
      if (credential.status !== "active") {
        return Result.err(
          PermissionError.create(
            `Credential is ${credential.status} -- reveal requests require an active credential`,
            {
              credentialId: input.credentialId,
              authenticatedCredentialId: ctx.credentialId,
              status: credential.status,
            },
          ),
        );
      }

      // Validate chatId is within the credential's chatIds
      if (!credential.config.chatIds.includes(input.chatId)) {
        return Result.err(
          PermissionError.create(
            "Chat is not within the credential's scoped conversations",
            {
              credentialId: input.credentialId,
              authenticatedCredentialId: ctx.credentialId,
              chatId: input.chatId,
            },
          ),
        );
      }

      // Get or create the reveal state store for this credential
      const storeResult =
        deps.internalManager.getRevealState(targetCredentialId);
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
        groupId: input.chatId,
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
      description: "Request content to be revealed to a credential holder",
      readOnly: false,
    },
  };

  const list: ActionSpec<
    { credentialId: string },
    RevealStateSnapshot,
    SignetError
  > = {
    id: "reveal.list",
    input: z.object({
      credentialId: z.string(),
    }),
    handler: async (input, ctx) => {
      const targetResult = resolveCredentialTarget(
        input.credentialId,
        ctx.credentialId,
      );
      if (Result.isError(targetResult)) {
        return targetResult;
      }

      const storeResult = deps.internalManager.getRevealState(
        targetResult.value,
      );
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
      description: "List active reveals for a credential",
      readOnly: true,
    },
  };

  return [widenActionSpec(request), widenActionSpec(list)];
}
