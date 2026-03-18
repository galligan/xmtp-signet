import { z } from "zod";

/** Verdict for a single verifier check. */
export const CheckVerdict: z.ZodEnum<["pass", "fail", "skip"]> = z
  .enum(["pass", "fail", "skip"])
  .describe("Outcome of a single verification check");

/** Type alias for a single verifier check verdict. */
export type CheckVerdict = z.infer<typeof CheckVerdict>;

/** Result payload for one verification check. */
export type VerificationCheck = {
  checkId: string;
  verdict: CheckVerdict;
  reason: string;
  evidence: Record<string, unknown> | null;
};

const _VerificationCheck = z
  .object({
    checkId: z.string().describe("Identifier for the check type"),
    verdict: CheckVerdict.describe("Pass, fail, or skip"),
    reason: z.string().describe("Human-readable explanation of the result"),
    evidence: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe("Structured evidence supporting the verdict"),
  })
  .describe("Result of a single verification check");

/** Zod schema for a single verification check result. */
export const VerificationCheck: z.ZodType<VerificationCheck> =
  _VerificationCheck;
