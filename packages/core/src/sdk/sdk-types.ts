/**
 * Structural types mirroring @xmtp/node-sdk v6.0.0 shapes.
 *
 * These allow the signet to interact with SDK objects without importing
 * the real SDK, which requires native bindings. Both production code
 * (for structural typing against real SDK objects) and tests (for mock
 * construction) use these interfaces.
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
  isActive: boolean;
  createdAtNs: bigint;
  createdAt: Date;
  members(): Promise<SdkGroupMemberShape[]>;
  sync(): Promise<void>;
  sendText(text: string): Promise<string>;
  send(encoded: unknown): Promise<string>;
  addMembers(inboxIds: string[]): Promise<void>;
  removeMembers(inboxIds: string[]): Promise<void>;
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

/** Mirrors the Conversations object from @xmtp/node-sdk */
export interface SdkConversationsShape {
  getConversationById(id: string): Promise<SdkGroupShape | undefined>;
  list(options?: unknown): Promise<SdkGroupShape[]>;
  listGroups(options?: unknown): SdkGroupShape[];
  createDm(inboxId: string): Promise<SdkGroupShape>;
  createGroup(
    inboxIds: string[],
    options?: { name?: string },
  ): Promise<SdkGroupShape>;
  sync(): Promise<void>;
  syncAll(consentStates?: unknown[]): Promise<{ numConversations: number }>;
  stream(options?: unknown): Promise<SdkAsyncStreamProxyShape<SdkGroupShape>>;
  streamGroups(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkGroupShape>>;
  streamAllMessages(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkDecodedMessageShape>>;
  streamAllGroupMessages(
    options?: unknown,
  ): Promise<SdkAsyncStreamProxyShape<SdkDecodedMessageShape>>;
}

/** Mirrors the Client from @xmtp/node-sdk */
export interface SdkClientShape {
  inboxId: string;
  installationId: string;
  conversations: SdkConversationsShape;
}
