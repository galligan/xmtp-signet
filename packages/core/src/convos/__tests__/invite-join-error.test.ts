import { describe, expect, test } from "bun:test";
import {
  ContentTypeInviteJoinError,
  InviteJoinErrorCodec,
  InviteJoinErrorType,
  decodeInviteJoinError,
  encodeInviteJoinError,
  extractInviteJoinError,
  getInviteJoinErrorMessage,
  isInviteJoinErrorContentType,
} from "../invite-join-error.js";

describe("invite-join-error", () => {
  test("round-trips invite join errors", () => {
    const timestamp = new Date("2026-04-15T14:00:00.000Z");
    const encoded = encodeInviteJoinError({
      errorType: InviteJoinErrorType.ConversationExpired,
      inviteTag: "tag-123",
      timestamp,
    });

    expect(encoded.type).toEqual(ContentTypeInviteJoinError);

    const decoded = decodeInviteJoinError(encoded);
    expect(decoded).toEqual({
      errorType: InviteJoinErrorType.ConversationExpired,
      inviteTag: "tag-123",
      timestamp,
    });
  });

  test("extracts already-decoded errors", () => {
    const timestamp = new Date("2026-04-15T14:00:00.000Z");
    expect(
      extractInviteJoinError({
        errorType: InviteJoinErrorType.GenericFailure,
        inviteTag: "tag-456",
        timestamp,
      }),
    ).toEqual({
      errorType: InviteJoinErrorType.GenericFailure,
      inviteTag: "tag-456",
      timestamp,
    });
  });

  test("extracts encoded errors", () => {
    const encoded = encodeInviteJoinError({
      errorType: InviteJoinErrorType.Unknown,
      inviteTag: "tag-789",
      timestamp: new Date("2026-04-15T14:00:00.000Z"),
    });

    expect(extractInviteJoinError(encoded)?.inviteTag).toBe("tag-789");
  });

  test("exposes the current SDK error content type", () => {
    expect(isInviteJoinErrorContentType("inviteJoinError")).toBe(true);
    expect(isInviteJoinErrorContentType("convos.app/inviteJoinError:1.0")).toBe(
      true,
    );
    expect(
      isInviteJoinErrorContentType("convos.org/invite_join_error:1.0"),
    ).toBe(true);
    expect(isInviteJoinErrorContentType("text")).toBe(false);
  });

  test("provides a useful fallback string", () => {
    const codec = new InviteJoinErrorCodec();
    expect(
      codec.fallback({
        errorType: InviteJoinErrorType.ConversationExpired,
        inviteTag: "tag-123",
        timestamp: new Date("2026-04-15T14:00:00.000Z"),
      }),
    ).toBe("This conversation is no longer available");
    expect(
      getInviteJoinErrorMessage({
        errorType: InviteJoinErrorType.GenericFailure,
        inviteTag: "tag-123",
        timestamp: new Date("2026-04-15T14:00:00.000Z"),
      }),
    ).toBe("Failed to join conversation");
  });
});
