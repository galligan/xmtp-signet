import { z } from "zod";
import { ContentTypeId } from "./content-types.js";
import { ViewConfig } from "./view.js";
import { RevealRequest } from "./reveal.js";

export type SendMessageRequest = {
  type: "send_message";
  requestId: string;
  groupId: string;
  contentType: string;
  content?: unknown;
};

const _SendMessageRequest = z
  .object({
    type: z.literal("send_message").describe("Request type discriminator"),
    requestId: z
      .string()
      .describe("Client-generated request ID for correlation"),
    groupId: z.string().describe("Target group"),
    contentType: ContentTypeId.describe("Content type of the message"),
    content: z.unknown().describe("Encoded message payload"),
  })
  .describe("Send a message to a group");

export const SendMessageRequest: z.ZodType<SendMessageRequest> =
  _SendMessageRequest;

export type SendReactionRequest = {
  type: "send_reaction";
  requestId: string;
  groupId: string;
  messageId: string;
  action: "added" | "removed";
  content: string;
};

const _SendReactionRequest = z
  .object({
    type: z.literal("send_reaction").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    groupId: z.string().describe("Target group"),
    messageId: z.string().describe("Message to react to"),
    action: z.enum(["added", "removed"]).describe("Add or remove reaction"),
    content: z.string().describe("Reaction content"),
  })
  .describe("React to a message");

export const SendReactionRequest: z.ZodType<SendReactionRequest> =
  _SendReactionRequest;

export type SendReplyRequest = {
  type: "send_reply";
  requestId: string;
  groupId: string;
  messageId: string;
  contentType: string;
  content?: unknown;
};

const _SendReplyRequest = z
  .object({
    type: z.literal("send_reply").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    groupId: z.string().describe("Target group"),
    messageId: z.string().describe("Message to reply to"),
    contentType: ContentTypeId.describe("Content type of the reply body"),
    content: z.unknown().describe("Encoded reply payload"),
  })
  .describe("Reply to a message in a thread");

export const SendReplyRequest: z.ZodType<SendReplyRequest> = _SendReplyRequest;

export type UpdateViewRequest = {
  type: "update_view";
  requestId: string;
  view: z.infer<typeof ViewConfig>;
};

const _UpdateViewRequest = z
  .object({
    type: z.literal("update_view").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    view: ViewConfig.describe("Requested view update"),
  })
  .describe("Request a view update (signet may reject if material escalation)");

export const UpdateViewRequest: z.ZodType<UpdateViewRequest> =
  _UpdateViewRequest;

export type RevealContentRequest = {
  type: "reveal_content";
  requestId: string;
  reveal: z.infer<typeof RevealRequest>;
};

const _RevealContentRequest = z
  .object({
    type: z.literal("reveal_content").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    reveal: RevealRequest.describe("Reveal details"),
  })
  .describe("Request content be revealed to the agent");

export const RevealContentRequest: z.ZodType<RevealContentRequest> =
  _RevealContentRequest;

export type ConfirmActionRequest = {
  type: "confirm_action";
  requestId: string;
  actionId: string;
  confirmed: boolean;
};

const _ConfirmActionRequest = z
  .object({
    type: z.literal("confirm_action").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    actionId: z.string().describe("Action being confirmed or denied"),
    confirmed: z.boolean().describe("Whether the action is approved"),
  })
  .describe("Confirm or deny a pending action");

export const ConfirmActionRequest: z.ZodType<ConfirmActionRequest> =
  _ConfirmActionRequest;

export type HeartbeatRequest = {
  type: "heartbeat";
  requestId: string;
  sessionId: string;
};

const _HeartbeatRequest = z
  .object({
    type: z.literal("heartbeat").describe("Request type discriminator"),
    requestId: z.string().describe("Client-generated request ID"),
    sessionId: z.string().describe("Session sending the heartbeat"),
  })
  .describe("Heartbeat from the harness to keep the session alive");

export const HeartbeatRequest: z.ZodType<HeartbeatRequest> = _HeartbeatRequest;

export type HarnessRequest =
  | SendMessageRequest
  | SendReactionRequest
  | SendReplyRequest
  | UpdateViewRequest
  | RevealContentRequest
  | ConfirmActionRequest
  | HeartbeatRequest;

/** Discriminated union of all harness-to-signet requests. */
export const HarnessRequest: z.ZodType<HarnessRequest> = z
  .discriminatedUnion("type", [
    _SendMessageRequest,
    _SendReactionRequest,
    _SendReplyRequest,
    _UpdateViewRequest,
    _RevealContentRequest,
    _ConfirmActionRequest,
    _HeartbeatRequest,
  ])
  .describe("Any request a harness may send to the signet");
