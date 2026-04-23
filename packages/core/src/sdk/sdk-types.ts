/**
 * Structural types mirroring @xmtp/node-sdk v6.0.0 (which re-exports
 * core option/record shapes from @xmtp/node-bindings v1.10.0).
 *
 * These allow the signet to interact with SDK objects without importing
 * the real SDK, which requires native bindings. Both production code
 * (for structural typing against real SDK objects) and tests (for mock
 * construction) use these interfaces.
 *
 * When bumping @xmtp/node-sdk, re-verify these shapes against the
 * installed bindings (e.g. CreateGroupOptions.groupName lives in
 * node_modules/@xmtp/node-bindings/dist/index.d.ts).
 */

/** Mirrors @xmtp/node-sdk Identifier */
export interface SdkIdentifierShape {
  identifier: string;
  identifierKind: "Ethereum" | "Passkey";
}

/** Mirrors @xmtp/node-sdk GroupMember */
export interface SdkGroupMemberShape {
  inboxId: string;
  accountIdentifiers: SdkIdentifierShape[];
  installationIds: string[];
  permissionLevel: "member" | "admin" | "super_admin";
}

/** Mirrors @xmtp/node-sdk ContentTypeId */
export interface SdkContentTypeIdShape {
  authorityId: string;
  typeId: string;
  versionMajor: number;
  versionMinor: number;
}

/** Mirrors @xmtp/node-sdk DecodedMessage */
export interface SdkDecodedMessageShape {
  content: unknown;
  contentType: SdkContentTypeIdShape;
  conversationId: string;
  deliveryStatus: "unpublished" | "published" | "failed";
  id: string;
  kind: "application" | "membership_change";
  senderInboxId: string;
  sentAt: Date;
  sentAtNs: bigint;
}

/** Mirrors @xmtp/node-sdk AsyncStreamProxy */
export interface SdkAsyncStreamProxyShape<T> extends AsyncIterable<T> {
  next(): Promise<{ value: T; done: boolean }>;
  return(): Promise<{ value: undefined; done: boolean }>;
  end(): Promise<{ value: undefined; done: boolean }>;
  isDone: boolean;
}

/** Mirrors the shape of a Group from @xmtp/node-sdk */
export interface SdkGroupShape {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  isActive: boolean;
  createdAtNs: bigint;
  createdAt: Date;
  members(): Promise<SdkGroupMemberShape[]>;
  sync(): Promise<void>;
  sendText(text: string): Promise<string>;
  send(encoded: unknown): Promise<string>;
  sendReaction(
    reaction: {
      reference: string;
      referenceInboxId?: string;
      action: "added" | "removed";
      content: string;
      schema: "unicode" | "shortcode" | "custom";
    },
    isOptimistic?: boolean,
  ): Promise<string>;
  sendReadReceipt(isOptimistic?: boolean): Promise<string>;
  sendReply(
    reply: {
      reference: string;
      referenceInboxId?: string;
      content: unknown;
    },
    isOptimistic?: boolean,
  ): Promise<string>;
  addMembers(inboxIds: string[]): Promise<void>;
  removeMembers(inboxIds: string[]): Promise<void>;
  updateName(name: string): Promise<void>;
  updateDescription(description: string): Promise<void>;
  updateImageUrl(imageUrl: string): Promise<void>;
  leaveGroup(): Promise<void>;
  addAdmin(inboxId: string): Promise<void>;
  removeAdmin(inboxId: string): Promise<void>;
  addSuperAdmin(inboxId: string): Promise<void>;
  removeSuperAdmin(inboxId: string): Promise<void>;
  messages(options?: {
    limit?: number;
    sentBeforeNs?: bigint;
    sentAfterNs?: bigint;
    direction?: number;
  }): Promise<SdkDecodedMessageShape[]>;
  stream(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkDecodedMessageShape>>;
  metadata(): Promise<{
    creatorInboxId: string;
    conversationType: "group";
  }>;
}

/** Mirrors the shape of a DM from @xmtp/node-sdk. */
export interface SdkDmShape extends Omit<SdkGroupShape, "metadata"> {
  readonly peerInboxId: string;
  metadata(): Promise<{
    creatorInboxId: string;
    conversationType: "dm";
  }>;
}

/** Mirrors the Conversations object from @xmtp/node-sdk */
export interface SdkConversationsShape {
  getConversationById(id: string): Promise<SdkGroupShape | undefined>;
  getMessageById(id: string): SdkDecodedMessageShape | undefined;
  list(options?: unknown): Promise<SdkGroupShape[]>;
  listGroups(options?: unknown): SdkGroupShape[];
  createDm(inboxId: string): Promise<SdkGroupShape>;
  createGroup(
    inboxIds: string[],
    options?: { groupName?: string },
  ): Promise<SdkGroupShape>;
  sync(): Promise<void>;
  syncAll(consentStates?: unknown[]): Promise<{ numConversations: number }>;
  stream(options?: unknown): Promise<SdkAsyncStreamProxyShape<SdkGroupShape>>;
  streamGroups(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkGroupShape>>;
  streamDms(options?: unknown): Promise<SdkAsyncStreamProxyShape<SdkDmShape>>;
  streamAllMessages(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkDecodedMessageShape>>;
  streamAllGroupMessages(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkDecodedMessageShape>>;
}

/** Consent entity type enum values from @xmtp/node-bindings */
export type SdkConsentEntityType = "InboxId" | "GroupId";

/** Consent state enum values from @xmtp/node-bindings */
export type SdkConsentState = "Unknown" | "Allowed" | "Denied";

/** Mirrors the Consent record from @xmtp/node-bindings */
export interface SdkConsentRecord {
  entityType: SdkConsentEntityType;
  entity: string;
  state: SdkConsentState;
}

/** Mirrors the Preferences object from @xmtp/node-sdk */
export interface SdkPreferencesShape {
  getConsentState(
    entityType: SdkConsentEntityType,
    entity: string,
  ): Promise<SdkConsentState>;
  setConsentStates(consentStates: SdkConsentRecord[]): Promise<void>;
}

/** Mirrors the Client from @xmtp/node-sdk */
export interface SdkClientShape {
  inboxId: string;
  installationId: string;
  conversations: SdkConversationsShape;
  preferences: SdkPreferencesShape;
}
