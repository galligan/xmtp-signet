import type {
  ConvosContentTypeId,
  EncodedConvosContent,
} from "./join-request-content.js";
import { isEncodedConvosContent } from "./join-request-content.js";

/** Error types surfaced by the Convos invite-join failure content. */
export enum InviteJoinErrorType {
  ConversationExpired = "conversationExpired",
  GenericFailure = "genericFailure",
  Unknown = "unknown",
}

/** Structured payload describing why an invite join failed. */
export interface InviteJoinError {
  readonly errorType: InviteJoinErrorType;
  readonly inviteTag: string;
  readonly timestamp: Date;
}

/** Content type descriptor for Convos invite-join errors. */
export const ContentTypeInviteJoinError: ConvosContentTypeId = {
  authorityId: "convos.app",
  typeId: "inviteJoinError",
  versionMajor: 1,
  versionMinor: 0,
};

/** Encodes an invite-join error for transport over XMTP custom content. */
export function encodeInviteJoinError(
  error: InviteJoinError,
): EncodedConvosContent {
  return {
    type: ContentTypeInviteJoinError,
    parameters: {},
    content: new TextEncoder().encode(
      JSON.stringify({
        errorType: error.errorType,
        inviteTag: error.inviteTag,
        timestamp: error.timestamp.toISOString(),
      }),
    ),
    fallback: getInviteJoinErrorMessage(error),
  };
}

/** Decodes an invite-join error from the XMTP custom-content envelope. */
export function decodeInviteJoinError(
  encoded: Pick<EncodedConvosContent, "content">,
): InviteJoinError {
  const parsed = JSON.parse(
    new TextDecoder().decode(encoded.content),
  ) as Record<string, unknown>;
  const errorType = Object.values(InviteJoinErrorType).includes(
    parsed["errorType"] as InviteJoinErrorType,
  )
    ? (parsed["errorType"] as InviteJoinErrorType)
    : InviteJoinErrorType.Unknown;

  return {
    errorType,
    inviteTag:
      typeof parsed["inviteTag"] === "string" ? parsed["inviteTag"] : "",
    timestamp:
      typeof parsed["timestamp"] === "string"
        ? new Date(parsed["timestamp"])
        : new Date(0),
  };
}

/** Extracts an invite-join error from decoded JSON or encoded Convos content. */
export function extractInviteJoinError(
  value: unknown,
): InviteJoinError | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "errorType" in value &&
    "inviteTag" in value &&
    "timestamp" in value
  ) {
    const error = value as Record<string, unknown>;
    const timestamp = error["timestamp"];
    return {
      errorType: Object.values(InviteJoinErrorType).includes(
        error["errorType"] as InviteJoinErrorType,
      )
        ? (error["errorType"] as InviteJoinErrorType)
        : InviteJoinErrorType.Unknown,
      inviteTag:
        typeof error["inviteTag"] === "string" ? error["inviteTag"] : "",
      timestamp:
        timestamp instanceof Date
          ? timestamp
          : typeof timestamp === "string"
            ? new Date(timestamp)
            : new Date(0),
    };
  }

  if (isEncodedConvosContent(value)) {
    try {
      return decodeInviteJoinError(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/** Matches legacy and fully qualified content-type labels for join failures. */
export function isInviteJoinErrorContentType(
  contentType: string | undefined,
): boolean {
  return (
    contentType === "inviteJoinError" ||
    contentType === "convos.app/inviteJoinError:1.0" ||
    contentType === "convos.org/invite_join_error:1.0" ||
    contentType === "invite_join_error"
  );
}

/** Returns the human-readable fallback string for an invite-join error. */
export function getInviteJoinErrorMessage(error: InviteJoinError): string {
  switch (error.errorType) {
    case InviteJoinErrorType.ConversationExpired:
      return "This conversation is no longer available";
    case InviteJoinErrorType.GenericFailure:
    case InviteJoinErrorType.Unknown:
    default:
      return "Failed to join conversation";
  }
}

/** Codec that round-trips Convos invite-join errors through XMTP custom content. */
export class InviteJoinErrorCodec {
  get contentType(): ConvosContentTypeId {
    return ContentTypeInviteJoinError;
  }

  encode(content: InviteJoinError): EncodedConvosContent {
    return encodeInviteJoinError(content);
  }

  decode(content: EncodedConvosContent): InviteJoinError {
    return decodeInviteJoinError(content);
  }

  fallback(content: InviteJoinError): string {
    return getInviteJoinErrorMessage(content);
  }

  shouldPush(): boolean {
    return true;
  }
}
