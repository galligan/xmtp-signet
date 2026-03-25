// Core types
export type {
  CoreState,
  CoreContext,
  GroupInfo,
  RawMessage,
  RawEvent,
} from "./core-types.js";

// Credential types
export type { CredentialRecord, MaterialityCheck } from "./credential-types.js";

// Policy types
export type { PolicyDelta, GrantError } from "./policy-types.js";

// Seal types and wire format schemas
export { SignedRevocationEnvelope } from "./seal-envelope.js";
export type { MessageProvenanceMetadata } from "./seal-envelope.js";

// Handler types
export type {
  AdminAuthContext,
  HandlerContext,
  Handler,
} from "./handler-types.js";

// Action types
export type {
  ActionSpec,
  CliSurface,
  McpSurface,
  CliOption,
} from "./action-spec.js";

// Action registry
export { createActionRegistry } from "./action-registry.js";
export type { ActionRegistry } from "./action-registry.js";

// Result envelope
export { toActionResult } from "./result-envelope.js";
export type { ActionResult } from "./result-envelope.js";

// Service interfaces
export type {
  SignetCore,
  CredentialManager,
  OperatorManager,
  PolicyManager,
  ScopeGuard,
  SealManager,
} from "./services.js";

// Provider interfaces
export type {
  SignerProvider,
  SealStamper,
  SealPublisher,
  RevealStateStore,
  RevealStateEntry,
  RevealStateSnapshot,
} from "./providers.js";
