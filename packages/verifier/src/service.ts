import { Result } from "better-result";
import {
  type InternalError,
  type ValidationError,
  type TimeoutError,
  InternalError as InternalErrorClass,
} from "@xmtp/signet-schemas";
import type { VerificationRequest } from "./schemas/request.js";
import type {
  VerificationStatement,
  VerificationVerdict,
} from "./schemas/statement.js";
import type { VerificationCheck } from "./schemas/check.js";
import type { VerifierSelfSeal } from "./schemas/self-seal.js";
import type { VerifierConfig } from "./config.js";
import type { CheckHandler } from "./checks/handler.js";
import type { RateLimiter } from "./rate-limiter.js";
import { createRateLimiter } from "./rate-limiter.js";
import { canonicalizeStatement } from "./canonicalize.js";
import { determineVerdict, determineVerifiedTier } from "./verdict.js";
import { createSourceAvailableCheck } from "./checks/source-available.js";
import { createBuildProvenanceCheck } from "./checks/build-provenance.js";
import { createReleaseSigningCheck } from "./checks/release-signing.js";
import { createSealSignatureCheck } from "./checks/seal-signature.js";
import { createSealChainCheck } from "./checks/seal-chain.js";
import { createSchemaComplianceCheck } from "./checks/schema-compliance.js";
import {
  DEFAULT_MAX_REQUESTS_PER_HOUR,
  DEFAULT_STATEMENT_TTL_SECONDS,
} from "./config.js";

const HOUR_MS = 3_600_000;

const ALL_CHECK_IDS = [
  "source_available",
  "build_provenance",
  "release_signing",
  "seal_signature",
  "seal_chain",
  "schema_compliance",
] as const;

export interface VerifierServiceOptions {
  readonly config: VerifierConfig;
  /** Injectable signing function. Signs canonical bytes, returns base64. */
  readonly sign: (bytes: Uint8Array) => Promise<string>;
  /** Injectable ID generator. */
  readonly generateId?: () => string;
  /** Injectable clock for testing. */
  readonly now?: () => number;
  /** Override check handlers for testing. */
  readonly checks?: readonly CheckHandler[];
  /** Override rate limiter for testing. */
  readonly rateLimiter?: RateLimiter;
}

export interface VerifierService {
  handleRequest(
    request: VerificationRequest,
    senderInboxId: string,
  ): Promise<
    Result<
      VerificationStatement,
      ValidationError | InternalError | TimeoutError
    >
  >;
  selfSeal(): VerifierSelfSeal;
}

export function createVerifierService(
  options: VerifierServiceOptions,
): VerifierService {
  const { config, sign } = options;
  const getNow = options.now ?? (() => Date.now());
  const generateId = options.generateId ?? (() => crypto.randomUUID());

  const rateLimiter =
    options.rateLimiter ??
    createRateLimiter({
      maxRequests:
        config.maxRequestsPerRequesterPerHour ?? DEFAULT_MAX_REQUESTS_PER_HOUR,
      windowMs: HOUR_MS,
      now: getNow,
    });

  const checks: readonly CheckHandler[] = options.checks ?? [
    createSourceAvailableCheck(),
    createBuildProvenanceCheck(config.buildProvenance),
    createReleaseSigningCheck(),
    createSealSignatureCheck(),
    createSealChainCheck(),
    createSchemaComplianceCheck(),
  ];

  const ttlSeconds =
    config.statementTtlSeconds ?? DEFAULT_STATEMENT_TTL_SECONDS;

  let cachedSelfSeal: VerifierSelfSeal | undefined;

  return {
    async handleRequest(
      request: VerificationRequest,
      senderInboxId: string,
    ): Promise<
      Result<
        VerificationStatement,
        ValidationError | InternalError | TimeoutError
      >
    > {
      // Rate limit check
      if (!rateLimiter.check(senderInboxId)) {
        const now = new Date(getNow());
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

        const rateLimitCheck: VerificationCheck = {
          checkId: "rate_limit_exceeded",
          verdict: "fail",
          reason: `Rate limit exceeded: max ${String(config.maxRequestsPerRequesterPerHour ?? DEFAULT_MAX_REQUESTS_PER_HOUR)} requests per hour`,
          evidence: {
            senderInboxId,
            limit:
              config.maxRequestsPerRequesterPerHour ??
              DEFAULT_MAX_REQUESTS_PER_HOUR,
          },
        };

        const statement = await buildAndSignStatement(
          {
            statementId: generateId(),
            requestId: request.requestId,
            verifierInboxId: config.verifierInboxId,
            signetInboxId: request.signetInboxId,
            agentInboxId: request.agentInboxId,
            verdict: "rejected" as VerificationVerdict,
            verifiedTier: "unverified" as const,
            checks: [rateLimitCheck],
            challengeNonce: request.challengeNonce,
            issuedAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
          },
          sign,
        );

        return statement;
      }

      // Run all checks in parallel
      const checkResults = await Promise.all(
        checks.map((handler) => handler.execute(request)),
      );

      // Collect results, bail on internal errors
      const completedChecks: VerificationCheck[] = [];
      for (const result of checkResults) {
        if (result.isErr()) {
          return Result.err(result.error);
        }
        completedChecks.push(result.value);
      }

      // Determine verdict and tier
      const verdicts = completedChecks.map((c) => c.verdict);
      const verdict = determineVerdict(verdicts);
      const verifiedTier = determineVerifiedTier(
        verdict,
        request.requestedTier,
      );

      const now = new Date(getNow());
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      return buildAndSignStatement(
        {
          statementId: generateId(),
          requestId: request.requestId,
          verifierInboxId: config.verifierInboxId,
          signetInboxId: request.signetInboxId,
          agentInboxId: request.agentInboxId,
          verdict,
          verifiedTier,
          checks: completedChecks,
          challengeNonce: request.challengeNonce,
          issuedAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
        sign,
      );
    },

    selfSeal(): VerifierSelfSeal {
      if (cachedSelfSeal !== undefined) {
        return cachedSelfSeal;
      }

      // Build a self-seal (signature is a placeholder in v0).
      cachedSelfSeal = {
        verifierInboxId: config.verifierInboxId,
        capabilities: {
          supportedTiers: ["unverified"],
          supportedChecks: [...ALL_CHECK_IDS],
          maxRequestsPerHour:
            config.maxRequestsPerRequesterPerHour ??
            DEFAULT_MAX_REQUESTS_PER_HOUR,
        },
        sourceRepoUrl: config.sourceRepoUrl,
        issuedAt: new Date(getNow()).toISOString(),
        signature: "",
      };

      return cachedSelfSeal;
    },
  };
}

async function buildAndSignStatement(
  fields: Omit<VerificationStatement, "signature" | "signatureAlgorithm">,
  sign: (bytes: Uint8Array) => Promise<string>,
): Promise<Result<VerificationStatement, InternalError>> {
  try {
    const canonical = canonicalizeStatement(fields);
    const signature = await sign(canonical);

    const statement: VerificationStatement = {
      ...fields,
      signature,
      signatureAlgorithm: "Ed25519",
    };

    return Result.ok(statement);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Result.err(
      InternalErrorClass.create(`Failed to sign statement: ${message}`),
    );
  }
}
