import { z } from "zod";
import {
  SessionToken,
  ViewConfig,
  GrantConfig,
  SignetEvent,
} from "@xmtp/signet-schemas";
import type { SignetEvent as SignetEventType } from "@xmtp/signet-schemas";

export type AuthFrame = {
  type: "auth";
  token: string;
  lastSeenSeq: number | null;
};

/** Auth frame sent by harness as first message. */
const _AuthFrame = z
  .object({
    type: z.literal("auth"),
    token: z.string().describe("Session bearer token"),
    lastSeenSeq: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Last sequence number seen, null for fresh connection"),
  })
  .describe("Authentication frame from harness");

export const AuthFrame: z.ZodType<AuthFrame> = _AuthFrame;

export type AuthenticatedFrame = {
  type: "authenticated";
  connectionId: string;
  session: z.infer<typeof SessionToken>;
  view: z.infer<typeof ViewConfig>;
  grant: z.infer<typeof GrantConfig>;
  resumedFromSeq: number | null;
};

/** Authenticated confirmation from signet. */
export const AuthenticatedFrame: z.ZodType<AuthenticatedFrame> = z
  .object({
    type: z.literal("authenticated"),
    connectionId: z.string().describe("Signet-assigned connection identifier"),
    session: SessionToken.describe("Session info"),
    view: ViewConfig.describe("Active view configuration"),
    grant: GrantConfig.describe("Active grant configuration"),
    resumedFromSeq: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe("Sequence number resume started from, null if fresh"),
  })
  .describe("Authentication success response from signet");

export type AuthErrorFrame = {
  type: "auth_error";
  code: number;
  message: string;
};

/** Auth error from signet, sent before close. */
export const AuthErrorFrame: z.ZodType<AuthErrorFrame> = z
  .object({
    type: z.literal("auth_error"),
    code: z.number().int().describe("Error code"),
    message: z.string().describe("Human-readable error description"),
  })
  .describe("Authentication failure response from signet");

export type BackpressureFrame = {
  type: "backpressure";
  buffered: number;
  limit: number;
};

/** Backpressure warning from signet. */
export const BackpressureFrame: z.ZodType<BackpressureFrame> = z
  .object({
    type: z.literal("backpressure"),
    buffered: z.number().int().describe("Current buffer depth"),
    limit: z.number().int().describe("Hard limit before disconnect"),
  })
  .describe("Backpressure warning from signet");

export type SequencedFrame = {
  seq: number;
  event: SignetEventType;
};

/** Sequenced event envelope for replay support. */
export const SequencedFrame: z.ZodType<SequencedFrame> = z
  .object({
    seq: z
      .number()
      .int()
      .positive()
      .describe(
        "Monotonically increasing sequence number, scoped to connection",
      ),
    event: SignetEvent.describe("The event payload"),
  })
  .describe("Sequenced event envelope for replay support");

/**
 * Discriminated union of all inbound frame types from harness.
 * The auth frame is the only non-request frame; requests use HarnessRequest
 * from schemas.
 */
export const InboundFrame: z.ZodType<AuthFrame> = z.discriminatedUnion("type", [
  _AuthFrame,
]);

export type InboundFrame = z.infer<typeof InboundFrame>;
