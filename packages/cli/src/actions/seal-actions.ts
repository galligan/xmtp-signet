import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec, SealManager } from "@xmtp/signet-contracts";
import type {
  SealEnvelopeType,
  SignetError,
  TrustTierType,
} from "@xmtp/signet-schemas";
import { TrustTier } from "@xmtp/signet-schemas";
import {
  createSealSignatureCheck,
  createSealChainCheck,
  createSchemaComplianceCheck,
  determineVerdict,
  VerificationCheck,
  VerificationVerdict,
  type VerificationRequest,
} from "@xmtp/signet-verifier";

/** Dependencies required to expose seal inspection actions through transports. */
export interface SealActionDeps {
  readonly sealManager: SealManager;
  readonly resolveSealPublicKey?: (
    envelope: SealEnvelopeType,
  ) => Promise<Result<string | null, SignetError>>;
}

type SealVerifyResult = {
  sealId: string;
  verdict: z.infer<typeof VerificationVerdict>;
  trustTier: TrustTierType;
  checks: z.infer<typeof VerificationCheck>[];
};

const SealVerifyResultSchema: z.ZodType<SealVerifyResult> = z.object({
  sealId: z.string(),
  verdict: VerificationVerdict,
  trustTier: TrustTier,
  checks: z.array(VerificationCheck),
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create seal inspection and verification actions for the admin surfaces. */
export function createSealActions(
  deps: SealActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const list: ActionSpec<
    { chatId?: string | undefined; credentialId?: string | undefined },
    readonly SealEnvelopeType[],
    SignetError
  > = {
    id: "seal.list",
    description: "List active current seals",
    intent: "read",
    idempotent: true,
    input: z.object({
      chatId: z.string().optional(),
      credentialId: z.string().optional(),
    }),
    handler: async (input) =>
      deps.sealManager.list({
        ...(input.chatId !== undefined ? { chatId: input.chatId } : {}),
        ...(input.credentialId !== undefined
          ? { credentialId: input.credentialId }
          : {}),
      }),
    cli: {
      command: "seal:list",
    },
    mcp: {
      toolName: "seal_list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ sealId: string }, SealEnvelopeType, SignetError> = {
    id: "seal.info",
    description: "Look up a seal by its ID",
    intent: "read",
    idempotent: true,
    input: z.object({
      sealId: z.string(),
    }),
    handler: async (input) => deps.sealManager.lookup(input.sealId),
    cli: {
      command: "seal:info",
    },
    mcp: {
      toolName: "seal_info",
    },
    http: {
      auth: "admin",
    },
  };

  const history: ActionSpec<
    { credentialId: string; chatId: string },
    readonly SealEnvelopeType[],
    SignetError
  > = {
    id: "seal.history",
    description: "Walk the seal chain for a credential in a chat",
    intent: "read",
    idempotent: true,
    input: z.object({
      credentialId: z.string(),
      chatId: z.string(),
    }),
    handler: async (input) =>
      deps.sealManager.history(input.credentialId, input.chatId),
    cli: {
      command: "seal:history",
    },
    mcp: {
      toolName: "seal_history",
    },
    http: {
      auth: "admin",
    },
  };

  const verify: ActionSpec<{ sealId: string }, SealVerifyResult, SignetError> =
    {
      id: "seal.verify",
      description: "Run local verification checks against a seal",
      intent: "read",
      idempotent: true,
      input: z.object({
        sealId: z.string(),
      }),
      output: SealVerifyResultSchema,
      handler: async (input) => {
        const envelopeResult = await deps.sealManager.lookup(input.sealId);
        if (Result.isError(envelopeResult)) {
          return envelopeResult;
        }

        const publicKeyResult = await resolveSealPublicKey(
          envelopeResult.value,
          deps.resolveSealPublicKey,
        );
        if (Result.isError(publicKeyResult)) {
          return publicKeyResult;
        }

        const request = buildVerificationRequest(
          envelopeResult.value,
          publicKeyResult.value,
        );
        const checks = [
          createSealSignatureCheck(),
          createSealChainCheck(),
          createSchemaComplianceCheck(),
        ];

        const completed: z.infer<typeof VerificationCheck>[] = [];
        for (const check of checks) {
          const result = await check.execute(request);
          if (Result.isError(result)) {
            return Result.err(result.error);
          }
          completed.push(result.value);
        }

        return Result.ok({
          sealId: envelopeResult.value.chain.current.sealId,
          verdict: determineVerdict(completed.map((check) => check.verdict)),
          trustTier:
            envelopeResult.value.chain.current.trustTier ?? "unverified",
          checks: completed,
        });
      },
      cli: {
        command: "seal:verify",
      },
      mcp: {
        toolName: "seal_verify",
      },
      http: {
        auth: "admin",
      },
    };

  return [
    widenActionSpec(list),
    widenActionSpec(info),
    widenActionSpec(history),
    widenActionSpec(verify),
  ];
}

async function resolveSealPublicKey(
  envelope: SealEnvelopeType,
  fallbackResolver?:
    | ((
        envelope: SealEnvelopeType,
      ) => Promise<Result<string | null, SignetError>>)
    | undefined,
): Promise<Result<string | null, SignetError>> {
  if (isRawEd25519PublicKeyHex(envelope.keyId)) {
    return Result.ok(envelope.keyId.toLowerCase());
  }

  if (!fallbackResolver) {
    return Result.ok(null);
  }

  return fallbackResolver(envelope);
}

function buildVerificationRequest(
  envelope: SealEnvelopeType,
  sealPublicKey: string | null,
): VerificationRequest {
  return {
    requestId: `seal-verify-${envelope.chain.current.sealId}`,
    agentInboxId: envelope.chain.current.operatorId,
    signetInboxId: "signet-local",
    groupId: envelope.chain.current.chatId,
    seal: envelope.chain.current,
    sealEnvelope: envelope,
    sealPublicKey,
    artifactDigest: "0".repeat(64),
    buildProvenanceBundle: null,
    sourceRepoUrl: "https://github.com/xmtp/xmtp-signet",
    releaseTag: null,
    requestedTier: envelope.chain.current.trustTier ?? "unverified",
    challengeNonce: "0".repeat(64),
  };
}

function isRawEd25519PublicKeyHex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

export { SealVerifyResultSchema };
