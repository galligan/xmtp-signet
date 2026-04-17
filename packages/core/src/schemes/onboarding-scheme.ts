import type { Result } from "better-result";
import type { Client as NodeSdkClient } from "@xmtp/node-sdk";
import type { SignetError } from "@xmtp/signet-schemas";
import type { XmtpEnv } from "../config.js";
import type { XmtpDecodedMessage } from "../xmtp-client-factory.js";

type NodeSdkCreateOptions = Parameters<typeof NodeSdkClient.create>[1];

/** All XMTP custom-content codecs an onboarding scheme wants registered. */
export type OnboardingCodecs = NonNullable<
  NonNullable<NodeSdkCreateOptions>["codecs"]
>;

/** Canonical identifier for an onboarding custom content type. */
export interface OnboardingContentTypeId {
  /** Namespaced authority that owns the content type. */
  readonly authorityId: string;
  /** Type identifier within the authority namespace. */
  readonly typeId: string;
  /** Major protocol version. */
  readonly versionMajor: number;
  /** Minor protocol version. */
  readonly versionMinor: number;
}

/** Encoded XMTP payload produced by an onboarding scheme codec. */
export interface EncodedOnboardingContent {
  /** Fully qualified content type descriptor for the encoded payload. */
  readonly type: OnboardingContentTypeId;
  /** Transport parameters attached to the encoded payload. */
  readonly parameters: Record<string, string>;
  /** Binary content bytes for the payload. */
  readonly content: Uint8Array;
  /** Optional text fallback for clients that do not understand the codec. */
  readonly fallback?: string;
}

/**
 * Group reference handed to invite generation.
 *
 * `format` lets a scheme preserve UUID-vs-string packing differences when its
 * wire format cares about that distinction.
 */
export interface ConversationRef {
  /** Network group identifier. */
  readonly groupId: string;
  /** Optional conversation ID packing hint. */
  readonly format?: "uuid" | "string";
}

/** Human-facing metadata attached to a generated invite. */
export interface InviteMetadata {
  /** Invite tag used for later verification or revocation checks. */
  readonly tag: string;
  /** Optional display name for the conversation. */
  readonly name?: string;
  /** Optional display description for the conversation. */
  readonly description?: string;
  /** Optional image URL associated with the conversation. */
  readonly imageUrl?: string;
}

/** Runtime options that affect invite generation. */
export interface InviteOptions {
  /** XMTP environment used to choose presentation defaults. */
  readonly env: XmtpEnv;
  /** Optional invite expiration timestamp. */
  readonly expiresAt?: Date;
  /** Whether the invite should expire after a single use. */
  readonly expiresAfterUse?: boolean;
}

/** Result of generating an onboarding invite. */
export interface GeneratedInvite {
  /** Full user-facing invite URL. */
  readonly url: string;
  /** Raw transport slug or token embedded in the URL. */
  readonly slug: string;
}

/** Context available to a scheme when generating an invite. */
export interface CreatorContext {
  /** Creator inbox ID that will appear in the invite. */
  readonly creatorInboxId: string;
  /** Hex-encoded secp256k1 private key owned by the creator identity. */
  readonly walletPrivateKeyHex: string;
}

/** Parsed invite data returned by an onboarding scheme. */
export interface ParsedInvite {
  /** Scheme identifier that parsed the invite. */
  readonly schemeId: string;
  /** Scheme-specific raw payload bytes used for later verification. */
  readonly signedPayloadBytes: Uint8Array;
  /** Scheme-specific signature bytes used for later verification. */
  readonly signatureBytes: Uint8Array;
  /** Encrypted or opaque conversation token carried by the invite. */
  readonly conversationToken: Uint8Array;
  /** Creator inbox ID declared by the invite. */
  readonly creatorInboxId: string;
  /** Invite tag used by the host-side join processor. */
  readonly tag: string;
  /** Optional display name carried by the invite. */
  readonly name?: string;
  /** Optional display description carried by the invite. */
  readonly description?: string;
  /** Optional image URL carried by the invite. */
  readonly imageUrl?: string;
  /** Whether the invite has already expired. */
  readonly isExpired: boolean;
  /** Whether the referenced conversation has already expired. */
  readonly isConversationExpired: boolean;
  /** Whether the invite is single-use. */
  readonly expiresAfterUse: boolean;
}

/** Simple profile data that the runtime asks a scheme to encode. */
export interface ProfileData {
  /** Optional display name. */
  readonly name?: string;
  /** Optional member kind hint. */
  readonly memberKind?: "human" | "agent";
  /** Optional image URL or avatar URL hint. */
  readonly imageUrl?: string;
  /** Optional flat metadata map. */
  readonly metadata?: Record<string, string | number | boolean>;
}

/** Snapshot entry for one member profile in a conversation. */
export interface MemberProfileData extends ProfileData {
  /** Inbox ID the profile belongs to. */
  readonly inboxId: string;
}

/** Resolved profile state recovered from conversation history. */
export interface ResolvedOnboardingProfile extends MemberProfileData {}

/** Raw inbound message that may contain a join request for a scheme. */
export interface IncomingJoinRequestMessage {
  /** Inbox ID of the requesting member. */
  readonly senderInboxId: string;
  /** Decoded message payload or fallback text. */
  readonly content: unknown;
}

/** Host-side capabilities needed to process an onboarding join request. */
export interface HostContext {
  /** Creator inbox ID that should match the invite payload. */
  readonly creatorInboxId: string;
  /** Hex-encoded secp256k1 private key owned by the host identity. */
  readonly walletPrivateKeyHex: string;
  /** Add the requesting inbox IDs to the resolved group. */
  readonly addMembersToGroup: (
    groupId: string,
    inboxIds: readonly string[],
  ) => Promise<Result<void, SignetError>>;
  /** Look up the invite tag recorded for the resolved group. */
  readonly getGroupInviteTag: (
    groupId: string,
  ) => Promise<Result<string | undefined, SignetError>>;
}

/** Result of a successful host-side join request. */
export interface ProcessedJoinRequest {
  /** Group that the requester was added to. */
  readonly groupId: string;
  /** Inbox ID of the requester that was accepted. */
  readonly requesterInboxId: string;
  /** Invite tag that authorized the join. */
  readonly inviteTag: string;
}

/** Scheme contract for invite lifecycle, profile lifecycle, and codec wiring. */
export interface OnboardingScheme {
  /** Stable scheme identifier such as `convos`. */
  readonly id: string;

  /** Generate an invite URL and slug for a conversation. */
  generate(
    conversation: ConversationRef,
    creator: CreatorContext,
    metadata: InviteMetadata,
    options: InviteOptions,
  ): Promise<Result<GeneratedInvite, SignetError>>;

  /** Parse an invite URL or raw slug into structured invite data. */
  parse(input: string): Result<ParsedInvite, SignetError>;

  /** Verify that a parsed invite is authentic for this scheme. */
  verify(invite: ParsedInvite): Result<void, SignetError>;

  /** Process an inbound join request using the host identity context. */
  processJoinRequest(
    host: HostContext,
    message: IncomingJoinRequestMessage,
  ): Promise<Result<ProcessedJoinRequest, SignetError>>;

  /** Encode a profile update for publication into a conversation. */
  encodeProfileUpdate(profile: ProfileData): EncodedOnboardingContent;

  /** Encode a profile snapshot for publication into a conversation. */
  encodeProfileSnapshot(
    members: readonly MemberProfileData[],
  ): EncodedOnboardingContent;

  /** Resolve the latest member profiles from message history. */
  resolveProfilesFromHistory(
    messages: readonly XmtpDecodedMessage[],
    memberInboxIds?: readonly string[],
  ): Map<string, ResolvedOnboardingProfile>;

  /** Return the codecs that should be registered for this scheme. */
  codecs(): OnboardingCodecs;

  /** Return true when a decoded payload matches the scheme's encoded shape. */
  isEncodedContent(value: unknown): value is EncodedOnboardingContent;

  /** Return true when a content type belongs to the scheme's join request. */
  isJoinRequestContentType(contentType: string | undefined): boolean;

  /** Fully qualified join request content-type label. */
  joinRequestContentType(): string;

  /** Fully qualified invite-join error content-type label. */
  errorContentType(): string;

  /** Fully qualified profile update content-type label. */
  profileUpdateContentType(): string;

  /** Fully qualified profile snapshot content-type label. */
  profileSnapshotContentType(): string;
}
