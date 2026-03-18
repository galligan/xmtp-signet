// Schemas
export { CheckVerdict, VerificationCheck } from "./schemas/check.js";
export {
  VerificationRequestSchema,
  type VerificationRequest,
} from "./schemas/request.js";
export {
  VerificationVerdict,
  VerificationStatementSchema,
  type VerificationStatement,
} from "./schemas/statement.js";
export {
  VerifierCapabilities,
  VerifierSelfSealSchema,
  type VerifierSelfSeal,
} from "./schemas/self-seal.js";

// Config
export {
  VerifierConfigSchema,
  type VerifierConfig,
  type BuildProvenanceConfig,
  DEFAULT_STATEMENT_TTL_SECONDS,
  DEFAULT_MAX_REQUESTS_PER_HOUR,
} from "./config.js";

// Content types
export {
  VERIFICATION_REQUEST_CONTENT_TYPE_ID,
  VERIFICATION_STATEMENT_CONTENT_TYPE_ID,
} from "./content-types.js";

// Canonicalize
export { canonicalizeStatement, canonicalize } from "./canonicalize.js";

// Rate limiter
export {
  createRateLimiter,
  type RateLimiter,
  type RateLimiterConfig,
} from "./rate-limiter.js";

// Verdict
export { determineVerdict, determineVerifiedTier } from "./verdict.js";

// Checks
export type { CheckHandler } from "./checks/handler.js";
export { createSourceAvailableCheck } from "./checks/source-available.js";
export { createBuildProvenanceCheck } from "./checks/build-provenance.js";
export { createReleaseSigningCheck } from "./checks/release-signing.js";
export { createSealSignatureCheck } from "./checks/seal-signature.js";
export { createSealChainCheck } from "./checks/seal-chain.js";
export { createSchemaComplianceCheck } from "./checks/schema-compliance.js";

// Service
export {
  createVerifierService,
  type VerifierService,
  type VerifierServiceOptions,
} from "./service.js";
