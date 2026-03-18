import type { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import type { XmtpEnv } from "./config.js";

/**
 * Abstract representation of an XMTP client instance.
 *
 * This interface decouples the core from the real `@xmtp/node-sdk` Client,
 * allowing tests to provide stub implementations without pulling in the SDK.
 */
export interface XmtpClient {
  /** The inbox ID assigned by the XMTP network. */
  readonly inboxId: string;

  /** Send a message to a group conversation. */
  sendMessage(
    groupId: string,
    content: unknown,
    contentType?: string,
  ): Promise<Result<string, SignetError>>;

  /** Sync all conversations. */
  syncAll(): Promise<Result<void, SignetError>>;

  /** Sync a specific group. */
  syncGroup(groupId: string): Promise<Result<void, SignetError>>;

  /** Get group metadata. */
  getGroupInfo(groupId: string): Promise<Result<XmtpGroupInfo, SignetError>>;

  /** List all groups the client is a member of. */
  listGroups(): Promise<Result<readonly XmtpGroupInfo[], SignetError>>;

  /** Create a DM conversation with a peer by inbox ID. */
  createDm(peerInboxId: string): Promise<Result<XmtpDmInfo, SignetError>>;

  /** Send a text message to a DM conversation. */
  sendDmMessage(
    dmId: string,
    text: string,
  ): Promise<Result<string, SignetError>>;

  /** Create a new group conversation with the given members. */
  createGroup(
    memberInboxIds: readonly string[],
    options?: { name?: string },
  ): Promise<Result<XmtpGroupInfo, SignetError>>;

  /** Add members to a group by inbox ID. */
  addMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, SignetError>>;

  /** Remove members from a group. */
  removeMembers(
    groupId: string,
    inboxIds: readonly string[],
  ): Promise<Result<void, SignetError>>;

  /**
   * Stream all messages across all groups.
   * Returns an async iterable and an abort function.
   */
  streamAllMessages(): Promise<Result<MessageStream, SignetError>>;

  /**
   * Stream group creation/join events.
   * Returns an async iterable and an abort function.
   */
  streamGroups(): Promise<Result<GroupStream, SignetError>>;
}

/** DM conversation metadata returned by the XMTP client. */
export interface XmtpDmInfo {
  readonly dmId: string;
  readonly peerInboxId: string;
}

/** Group metadata returned by the XMTP client. */
export interface XmtpGroupInfo {
  readonly groupId: string;
  readonly name: string;
  readonly description: string;
  readonly memberInboxIds: readonly string[];
  readonly createdAt: string;
}

/** A decoded message from the XMTP stream. */
export interface XmtpDecodedMessage {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: string;
  readonly content: unknown;
  readonly sentAt: string;
  /** Thread anchor ID — derived from Reply content type referenceId. Null for non-reply messages. */
  readonly threadId: string | null;
}

/** A group event from the XMTP stream. */
export interface XmtpGroupEvent {
  readonly groupId: string;
  readonly groupName: string;
}

/** Message stream with abort capability. */
export interface MessageStream {
  readonly messages: AsyncIterable<XmtpDecodedMessage>;
  readonly abort: () => void;
}

/** Group stream with abort capability. */
export interface GroupStream {
  readonly groups: AsyncIterable<XmtpGroupEvent>;
  readonly abort: () => void;
}

/** Options for creating an XMTP client. */
export interface XmtpClientCreateOptions {
  readonly identityId: string;
  readonly dbPath: string;
  readonly dbEncryptionKey: Uint8Array;
  readonly env: XmtpEnv;
  readonly appVersion: string;
  /**
   * Hex-encoded secp256k1 private key (0x-prefixed) for XMTP identity
   * registration. Used once during `Client.create()` to produce an
   * EIP-191 ECDSA signature. After registration, `Client.build()` is
   * used instead and no signer is needed.
   */
  readonly signerPrivateKey: `0x${string}`;
}

/**
 * Factory for creating XMTP client instances.
 *
 * Injected into SignetCore to decouple from the real `@xmtp/node-sdk`.
 * Tests provide a mock factory; production provides a factory that wraps
 * `Client.create()` from the SDK.
 */
export interface XmtpClientFactory {
  /** Create and register an XMTP client for the given identity. */
  create(
    options: XmtpClientCreateOptions,
  ): Promise<Result<XmtpClient, SignetError>>;
}

/**
 * Minimal signer interface needed by the factory.
 * Mirrors the shape of SignerProvider from contracts but avoids
 * importing it to keep this file self-contained for the interface.
 */
export interface SignerProviderLike {
  /** Sign data with the Ed25519 operational key. */
  sign(data: Uint8Array): Promise<Result<Uint8Array, SignetError>>;
  /** Get the Ed25519 public key. */
  getPublicKey(): Promise<Result<Uint8Array, SignetError>>;
  /** Get a fingerprint of the Ed25519 public key. */
  getFingerprint(): Promise<Result<string, SignetError>>;
  /**
   * Derive or retrieve a 32-byte encryption key for XMTP client databases.
   * Must return the same key for a given identity across restarts.
   */
  getDbEncryptionKey(
    identityId: string,
  ): Promise<Result<Uint8Array, SignetError>>;
  /**
   * Retrieve the secp256k1 private key for XMTP identity registration.
   * Returns a hex-encoded 0x-prefixed key. Used once during
   * `Client.create()` and persisted in the vault alongside Ed25519 keys.
   */
  getXmtpIdentityKey(
    identityId: string,
  ): Promise<Result<`0x${string}`, SignetError>>;
}
