// Attestation ID generation
export { generateAttestationId } from "./attestation-id.js";

// Canonical serialization
export { canonicalize } from "./canonicalize.js";

// Content type IDs and codec functions
export {
  ATTESTATION_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  AttestationMessage,
  RevocationMessage,
  encodeAttestationMessage,
  encodeRevocationMessage,
} from "./content-type.js";

// Grant-to-ops mapping
export { grantConfigToOps, grantConfigToToolScopes } from "./grant-ops.js";

// Attestation builder
export { buildAttestation } from "./build.js";
export type { AttestationInput, AttestationBuildResult } from "./build.js";

// Input delta computation
export { computeInputDelta } from "./compute-delta.js";

// Attestation manager
export { createAttestationManager } from "./manager.js";
export type {
  AttestationManagerDeps,
  AttestationManagerImpl,
  InputResolver,
} from "./manager.js";
