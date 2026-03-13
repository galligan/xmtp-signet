import { z } from "zod";

/** Parsed verifier configuration (all defaults applied). */
export type VerifierConfig = {
  verifierInboxId: string;
  sourceRepoUrl: string;
  statementTtlSeconds: number;
  maxRequestsPerRequesterPerHour: number;
};

/** Input to VerifierConfigSchema (fields with defaults are optional). */
type VerifierConfigInput = {
  verifierInboxId: string;
  sourceRepoUrl: string;
  statementTtlSeconds?: number | undefined;
  maxRequestsPerRequesterPerHour?: number | undefined;
};

export const VerifierConfigSchema: z.ZodType<
  VerifierConfig,
  z.ZodTypeDef,
  VerifierConfigInput
> = z.object({
  verifierInboxId: z
    .string()
    .describe("XMTP inbox ID of this verifier instance"),
  sourceRepoUrl: z.string().url().describe("URL of the verifier's source code"),
  statementTtlSeconds: z
    .number()
    .int()
    .positive()
    .default(86400)
    .describe("Statement lifetime in seconds (default: 24h)"),
  maxRequestsPerRequesterPerHour: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe("Rate limit per requester per hour"),
});

export const DEFAULT_STATEMENT_TTL_SECONDS = 86400;
export const DEFAULT_MAX_REQUESTS_PER_HOUR = 10;
