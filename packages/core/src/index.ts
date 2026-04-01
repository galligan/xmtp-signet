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
  ListMessagesOptions,
  MessageStream,
  GroupStream,
  SignerProviderLike,
  ConsentEntityType,
  ConsentState,
} from "./xmtp-client-factory.js";

// Identity registration
export { registerIdentity } from "./identity-registration.js";
export type {
  IdentityRegistrationDeps,
  RegisterIdentityInput,
  RegisteredIdentity,
} from "./identity-registration.js";

// Inbox actions
export { createInboxActions } from "./inbox-actions.js";
export type {
  InboxActionDeps,
  InboxSummary,
  InboxRemoveResult,
  RegisterInbox,
  CleanupInbox,
} from "./inbox-actions.js";

// ID mapping store
export { createSqliteIdMappingStore } from "./id-mapping-store.js";

// Operator storage partitions
export { createOperatorStorageManager } from "./operator-storage.js";
export type {
  OperatorStorageManager,
  OperatorPartition,
} from "./operator-storage.js";

// Consent actions
export { createConsentActions } from "./consent-actions.js";
export type { ConsentActionDeps } from "./consent-actions.js";

// Conversation actions
export { createConversationActions } from "./conversation-actions.js";
export type { ConversationActionDeps } from "./conversation-actions.js";

// Message actions
export { createMessageActions } from "./message-actions.js";
export type { MessageActionDeps } from "./message-actions.js";

// Search actions
export { createSearchActions } from "./search-actions.js";
export type { SearchActionDeps } from "./search-actions.js";

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

// Convos invite host (join request listener)
export {
  tryProcessJoinRequest,
  startInviteHostListener,
} from "./convos/invite-host.js";
export type { InviteHostDeps } from "./convos/invite-host.js";

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
