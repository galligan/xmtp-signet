export {
  ErrorCategory,
  ErrorCategoryMetaSchema,
  type ErrorCategoryMeta,
  ERROR_CATEGORY_META,
  errorCategoryMeta,
} from "./category.js";
export { type SignetError, type AnySignetError, matchError } from "./base.js";
export { ValidationError, SealError } from "./validation.js";
export { NotFoundError } from "./not-found.js";
export { PermissionError, GrantDeniedError } from "./permission.js";
export { AuthError, CredentialExpiredError } from "./auth.js";
export { InternalError } from "./internal.js";
export { TimeoutError } from "./timeout.js";
export { CancelledError } from "./cancelled.js";
export { NetworkError } from "./network.js";
