// Config
export {
  BrokerCoreConfigSchema,
  XmtpEnvSchema,
  IdentityModeSchema,
} from "./config.js";
export type { BrokerCoreConfig, XmtpEnv, IdentityMode } from "./config.js";

// Broker core
export { BrokerCoreImpl } from "./broker-core.js";
export type { BrokerState, SignerProviderFactory } from "./broker-core.js";

// Core context
export { BrokerCoreContext } from "./core-context.js";

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
