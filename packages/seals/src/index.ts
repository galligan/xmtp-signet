// Seal ID generation
export { generateSealId } from "./seal-id.js";

// Canonical serialization
export { canonicalize } from "./canonicalize.js";

// Content type IDs and codec functions
export {
  SEAL_CONTENT_TYPE_ID,
  REVOCATION_CONTENT_TYPE_ID,
  SealMessage,
  RevocationMessage,
  encodeSealMessage,
  encodeRevocationMessage,
} from "./content-type.js";

// Seal builder
export { buildSeal } from "./build.js";
export type { SealInput, SealBuildResult } from "./build.js";

// Payload delta computation
export { computePayloadDelta } from "./compute-delta.js";

// Seal stamper
export { createSealStamper } from "./stamper.js";
export type { SigningKeyHandle, StamperDeps } from "./stamper.js";

// Seal publisher
export { createSealPublisher } from "./publisher.js";
export type { PublisherDeps } from "./publisher.js";

// Chain validation
export { validateSealChain, verifyChainDelta } from "./chain-validator.js";

// Seal manager
export { createSealManager } from "./manager.js";
export type {
  SealManagerDeps,
  SealManagerImpl,
  InputResolver,
} from "./manager.js";
