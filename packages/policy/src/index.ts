// Types
export type {
  RawMessage,
  ProjectionResult,
  SignetContentTypeConfig,
} from "./types.js";

// View projection pipeline
export { projectMessage } from "./pipeline/project-message.js";
export { isInScope } from "./pipeline/scope-filter.js";
export { isContentTypeAllowed } from "./pipeline/content-type-filter.js";
export { resolveVisibility } from "./pipeline/visibility-resolver.js";
export { projectContent } from "./pipeline/content-projector.js";

// Content type allowlist
export { resolveEffectiveAllowlist } from "./allowlist.js";

// Permission validation
export {
  validateSendMessage,
  validateSendReply,
} from "./permissions/validate-send.js";
export { validateSendReaction } from "./permissions/validate-reaction.js";
export { validateGroupManagement } from "./permissions/validate-group-management.js";
export { validateEgress } from "./permissions/validate-egress.js";
export { checkChatInScope } from "./permissions/scope-check.js";

// Reveal state
export { createRevealStateStore } from "./reveal-state.js";
export type {
  RevealStateStore,
  RevealStateSnapshot,
  RevealStateEntry,
} from "./reveal-state.js";

// Materiality classifier
export { isMaterialChange, requiresReauthorization } from "./materiality.js";
