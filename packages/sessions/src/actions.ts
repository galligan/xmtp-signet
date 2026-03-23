/**
 * Credential lifecycle actions for CLI and MCP surfaces.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import type {
  SignetError,
  CredentialConfigType,
  CredentialRevocationReason as CredentialRevocationReasonType,
} from "@xmtp/signet-schemas";
import type { CredentialManager } from "@xmtp/signet-contracts";
import {
  CredentialConfig,
  CredentialRevocationReason,
} from "@xmtp/signet-schemas";

/** Dependencies for credential action registration. */
export interface CredentialActionDeps {
  readonly credentialManager: CredentialManager;
}

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  // The shared registry intentionally erases per-action input/output types.
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create CLI and MCP actions for credential lifecycle operations. */
export function createCredentialActions(
  deps: CredentialActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const issue: ActionSpec<CredentialConfigType, unknown, SignetError> = {
    id: "credential.issue",
    input: CredentialConfig,
    handler: async (input, ctx) => {
      const issuedBy = ctx.adminAuth !== undefined ? "owner" : ctx.operatorId;
      return deps.credentialManager.issue(
        input,
        issuedBy !== undefined ? { issuedBy } : undefined,
      );
    },
    cli: {
      command: "credential:issue",
      rpcMethod: "credential.issue",
    },
  };

  const list: ActionSpec<
    { operatorId?: string | undefined },
    unknown,
    SignetError
  > = {
    id: "credential.list",
    input: z.object({
      operatorId: z.string().optional(),
    }),
    handler: async (input) => deps.credentialManager.list(input.operatorId),
    cli: {
      command: "credential:list",
      rpcMethod: "credential.list",
    },
  };

  const inspect: ActionSpec<{ credentialId: string }, unknown, SignetError> = {
    id: "credential.lookup",
    input: z.object({
      credentialId: z.string(),
    }),
    handler: async (input) => deps.credentialManager.lookup(input.credentialId),
    cli: {
      command: "credential:inspect",
      rpcMethod: "credential.lookup",
    },
  };

  const revoke: ActionSpec<
    {
      credentialId: string;
      reason?: CredentialRevocationReasonType | undefined;
    },
    { revoked: true },
    SignetError
  > = {
    id: "credential.revoke",
    input: z.object({
      credentialId: z.string(),
      reason: CredentialRevocationReason.default("owner-initiated"),
    }),
    handler: async (input) => {
      const result = await deps.credentialManager.revoke(
        input.credentialId,
        input.reason ?? "owner-initiated",
      );
      if (Result.isError(result)) {
        return result;
      }
      return Result.ok({ revoked: true as const });
    },
    cli: {
      command: "credential:revoke",
      rpcMethod: "credential.revoke",
    },
  };

  return [
    widenActionSpec(issue),
    widenActionSpec(list),
    widenActionSpec(inspect),
    widenActionSpec(revoke),
  ];
}
