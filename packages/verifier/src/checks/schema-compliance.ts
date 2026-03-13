import { Result } from "better-result";
import { AttestationSchema, type InternalError } from "@xmtp-broker/schemas";
import type { VerificationCheck } from "../schemas/check.js";
import type { VerificationRequest } from "../schemas/request.js";
import type { CheckHandler } from "./handler.js";

export const SCHEMA_COMPLIANCE_CHECK_ID = "schema_compliance" as const;

/**
 * Verifies the attestation conforms to the expected schema.
 * Runs the attestation through AttestationSchema.safeParse.
 */
export function createSchemaComplianceCheck(): CheckHandler {
  return {
    checkId: SCHEMA_COMPLIANCE_CHECK_ID,

    async execute(
      request: VerificationRequest,
    ): Promise<Result<VerificationCheck, InternalError>> {
      if (request.attestation === null) {
        return Result.ok({
          checkId: SCHEMA_COMPLIANCE_CHECK_ID,
          verdict: "skip",
          reason: "No attestation provided",
          evidence: null,
        });
      }

      const parseResult = AttestationSchema.safeParse(request.attestation);

      if (parseResult.success) {
        return Result.ok({
          checkId: SCHEMA_COMPLIANCE_CHECK_ID,
          verdict: "pass",
          reason: "Attestation conforms to AttestationSchema",
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
        reason: `Attestation schema validation failed: ${String(parseResult.error.issues.length)} issue(s)`,
        evidence: { errors },
      });
    },
  };
}
