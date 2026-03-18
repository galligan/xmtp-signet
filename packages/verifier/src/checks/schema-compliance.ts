import { Result } from "better-result";
import { SealSchema, type InternalError } from "@xmtp/signet-schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

/** Check ID for schema compliance verification. */
export const SCHEMA_COMPLIANCE_CHECK_ID = "schema_compliance" as const;

/**
 * Verifies the seal conforms to the expected schema.
 * Runs the seal through SealSchema.safeParse.
 */
export function createSchemaComplianceCheck(): CheckHandler {
  return {
    checkId: SCHEMA_COMPLIANCE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.seal === null) {
        return Result.ok({
          checkId: SCHEMA_COMPLIANCE_CHECK_ID,
          verdict: "skip",
          reason: "No seal provided",
          evidence: null,
        });
      }

      const parseResult = SealSchema.safeParse(request.seal);

      if (parseResult.success) {
        return Result.ok({
          checkId: SCHEMA_COMPLIANCE_CHECK_ID,
          verdict: "pass",
          reason: "Seal conforms to SealSchema",
          evidence: null,
        });
      }

      const errors = parseResult.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

      return Result.ok({
        checkId: SCHEMA_COMPLIANCE_CHECK_ID,
        verdict: "fail",
        reason: `Seal schema validation failed: ${String(parseResult.error.issues.length)} issue(s)`,
        evidence: { errors },
      });
    },
  };
}
