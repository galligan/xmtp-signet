// Config
export {
  SignetCoreConfigSchema,
  XmtpEnvSchema,
  IdentityModeSchema,
} from "./config.js";
export type { SignetCoreConfig, XmtpEnv, IdentityMode } from "./config.js";

// Signet core
export { SignetCoreImpl } from "./signet-core.js";
export type { SignetState, SignerProviderFactory } from "./signet-core.js";

// Core context
export { SignetCoreContext } from "./core-context.js";

// Identity store
export { SqliteIdentityStore } from "./identity-store.js";
export type { AgentIdentity } from "./identity-store.js";

// Client registry
export { ClientRegistry } from "./client-registry.js";
export type { ManagedClient } from "./client-registry.js";

// Event emitter
export { CoreEventEmitter } from "./event-emitter.js";

// Raw events
export type {
  CoreRawEvent,
  RawEventHandler,
  RawMessageEvent,
  RawGroupJoinedEvent,
  RawGroupUpdatedEvent,
  RawCoreStartedEvent,
  RawCoreStoppedEvent,
  RawHeartbeatEvent,
} from "./raw-events.js";

// XMTP client abstraction
export type {
  XmtpClient,
  XmtpClientFactory,
  XmtpClientCreateOptions,
  XmtpDmInfo,
  XmtpGroupInfo,
  XmtpDecodedMessage,
  XmtpGroupEvent,
  MessageStream,
  GroupStream,
  SignerProviderLike,
} from "./xmtp-client-factory.js";

// Identity registration
export { registerIdentity } from "./identity-registration.js";
export type {
  IdentityRegistrationDeps,
  RegisterIdentityInput,
  RegisteredIdentity,
} from "./identity-registration.js";

// Conversation actions
export { createConversationActions } from "./conversation-actions.js";
export type { ConversationActionDeps } from "./conversation-actions.js";

// Convos invite parsing and join protocol
export {
  parseConvosInviteUrl,
  verifyConvosInvite,
} from "./convos/invite-parser.js";
export type { ParsedConvosInvite } from "./convos/invite-parser.js";
export { joinConversation } from "./convos/join.js";
export type {
  JoinConversationDeps,
  JoinConversationOptions,
  JoinResult,
} from "./convos/join.js";

// Convos invite generation
export {
  generateConvosInviteSlug,
  generateConvosInviteUrl,
  decryptConversationToken,
  unpackConversationId,
} from "./convos/invite-generator.js";
export type {
  GenerateInviteSlugOptions,
  GenerateInviteUrlOptions,
} from "./convos/invite-generator.js";

// Convos join request processing
export { processJoinRequest } from "./convos/process-join-requests.js";
export type {
  ProcessJoinRequestDeps,
  IncomingJoinMessage,
  JoinRequestResult,
} from "./convos/process-join-requests.js";

// SDK integration (production XmtpClientFactory implementation)
export {
  createSdkClientFactory,
  createSdkClient,
  createXmtpSigner,
  wrapSdkCall,
  wrapMessageStream,
  wrapGroupStream,
  toGroupInfo,
  toDecodedMessage,
} from "./sdk/index.js";
export type {
  SdkClientFactoryOptions,
  SdkClientOptions,
  SdkEoaSigner,
  SdkIdentifier,
  XmtpSignerConfig,
  WrapSdkCallHints,
} from "./sdk/index.js";
