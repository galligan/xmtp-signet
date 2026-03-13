import { z } from "zod";

export const CheckVerdict: z.ZodEnum<["pass", "fail", "skip"]> = z
  .enum(["pass", "fail", "skip"])
  .describe("Outcome of a single verification check");

export type CheckVerdict = z.infer<typeof CheckVerdict>;

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

export const VerificationCheck: z.ZodType<VerificationCheck> =
  _VerificationCheck;
