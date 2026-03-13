// Types
export type {
  RawMessage,
  ProjectionResult,
  BrokerContentTypeConfig,
} from "./types.js";

// View projection pipeline
export { projectMessage } from "./pipeline/project-message.js";
export { isInScope } from "./pipeline/scope-filter.js";
export { isContentTypeAllowed } from "./pipeline/content-type-filter.js";
export { resolveVisibility } from "./pipeline/visibility-resolver.js";
export { projectContent } from "./pipeline/content-projector.js";

// Content type allowlist
export { resolveEffectiveAllowlist, validateViewMode } from "./allowlist.js";

// Grant validation
export {
  validateSendMessage,
  validateSendReply,
} from "./grant/validate-send.js";
export { validateSendReaction } from "./grant/validate-reaction.js";
export { validateGroupManagement } from "./grant/validate-group-management.js";
export { validateToolUse } from "./grant/validate-tool.js";
export { validateEgress } from "./grant/validate-egress.js";
export { checkGroupInScope } from "./grant/scope-check.js";

// Reveal state
export { createRevealStateStore } from "./reveal-state.js";
export type {
  RevealStateStore,
  RevealStateSnapshot,
  RevealStateEntry,
} from "./reveal-state.js";

// Materiality classifier
export { isMaterialChange, requiresReauthorization } from "./materiality.js";
