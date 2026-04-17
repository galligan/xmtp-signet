/** Canonical identifier for a Convos custom content type. */
export interface ConvosContentTypeId {
  readonly authorityId: string;
  readonly typeId: string;
  readonly versionMajor: number;
  readonly versionMinor: number;
}

/** Decoded XMTP payload for a Convos custom content message. */
export interface EncodedConvosContent {
  readonly type: ConvosContentTypeId;
  readonly parameters: Record<string, string>;
  readonly content: Uint8Array;
  readonly fallback?: string;
}

/** Content type descriptor for Convos join requests. */
export const ContentTypeJoinRequest: ConvosContentTypeId = {
  authorityId: "convos.org",
  typeId: "join_request",
  versionMajor: 1,
  versionMinor: 0,
};

/** Optional profile fields a joiner can include with a join request. */
export interface JoinRequestProfile {
  readonly name?: string;
  readonly imageURL?: string;
  readonly memberKind?: string;
}

/** Structured join-request payload sent to a Convos invite host. */
export interface JoinRequestContent {
  readonly inviteSlug: string;
  readonly profile?: JoinRequestProfile;
  readonly metadata?: Record<string, string>;
}

/** Returns true when a decoded XMTP payload matches the Convos content shape. */
export function isEncodedConvosContent(
  value: unknown,
): value is EncodedConvosContent {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const type = candidate["type"];
  const content = candidate["content"];

  return (
    typeof type === "object" &&
    type !== null &&
    content instanceof Uint8Array &&
    typeof (type as Record<string, unknown>)["authorityId"] === "string" &&
    typeof (type as Record<string, unknown>)["typeId"] === "string"
  );
}

function isJoinRequestShape(value: unknown): value is JoinRequestContent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["inviteSlug"] === "string"
  );
}

/** Decodes a serialized Convos join request from its binary payload. */
export function decodeJoinRequest(
  encoded: Pick<EncodedConvosContent, "content">,
): JoinRequestContent {
  const json = new TextDecoder().decode(encoded.content);
  const parsed = JSON.parse(json) as unknown;
  if (!isJoinRequestShape(parsed)) {
    throw new Error("Missing inviteSlug in JoinRequest");
  }
  return parsed;
}

/** Extracts a join request from decoded JSON or encoded Convos content. */
export function extractJoinRequestContent(
  value: unknown,
): JoinRequestContent | undefined {
  if (isJoinRequestShape(value)) {
    return value;
  }

  if (isEncodedConvosContent(value)) {
    try {
      return decodeJoinRequest(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/** Matches the legacy and fully qualified content-type labels for join requests. */
export function isJoinRequestContentType(
  contentType: string | undefined,
): boolean {
  return (
    contentType === "join_request" ||
    contentType === "convos.org/join_request:1.0"
  );
}

/** Codec that round-trips Convos join requests through XMTP custom content. */
export class JoinRequestCodec {
  get contentType(): ConvosContentTypeId {
    return ContentTypeJoinRequest;
  }

  encode(content: JoinRequestContent): EncodedConvosContent {
    return {
      type: ContentTypeJoinRequest,
      parameters: {},
      content: new TextEncoder().encode(JSON.stringify(content)),
      fallback: content.inviteSlug,
    };
  }

  decode(content: EncodedConvosContent): JoinRequestContent {
    return decodeJoinRequest(content);
  }

  fallback(content: JoinRequestContent): string {
    return content.inviteSlug;
  }

  shouldPush(_content: unknown): boolean {
    return true;
  }
}
