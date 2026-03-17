import type { SignetEvent, SignetError } from "@xmtp/signet-schemas";
import type { Result } from "better-result";

/** Connection state machine states. */
export type HandlerState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "closed";

/** Callback fired on state transitions. */
export type StateChangeCallback = (
  newState: HandlerState,
  previousState: HandlerState,
) => void;

/** Callback fired for connection/protocol errors. */
export type ErrorCallback = (error: SignetError) => void;

/** Read-only session info derived from AuthenticatedFrame. */
export interface SessionInfo {
  readonly connectionId: string;
  readonly sessionId: string;
  readonly agentInboxId: string;
  readonly view: Record<string, unknown>;
  readonly grant: Record<string, unknown>;
  readonly expiresAt: string;
}

/** Content for sendMessage. */
export type MessageContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "custom";
      readonly contentType: string;
      readonly content: unknown;
    };

/** Successful message send result. */
export interface MessageSent {
  readonly messageId: string;
  readonly groupId: string;
  readonly sentAt: string;
}

/** Successful reaction send result. */
export interface ReactionSent {
  readonly messageId: string;
  readonly groupId: string;
  readonly sentAt: string;
}

/** Conversation summary for list results. */
export interface Conversation {
  readonly groupId: string;
  readonly name: string | null;
  readonly memberCount: number;
  readonly lastMessageAt: string | null;
}

/** Detailed conversation info. */
export interface ConversationInfo {
  readonly groupId: string;
  readonly name: string | null;
  readonly members: readonly string[];
  readonly createdAt: string;
  readonly lastMessageAt: string | null;
}

/** The public SignetHandler interface. */
export interface SignetHandler {
  /** Open the WebSocket connection and authenticate. */
  connect(): Promise<Result<void, SignetError>>;

  /** Close the connection gracefully. */
  disconnect(): Promise<Result<void, SignetError>>;

  /** Typed async iterable of signet events. */
  readonly events: AsyncIterable<SignetEvent>;

  /** Send a text message to a conversation. */
  sendMessage(
    groupId: string,
    content: MessageContent,
  ): Promise<Result<MessageSent, SignetError>>;

  /** Send a reaction to a message. */
  sendReaction(
    groupId: string,
    messageId: string,
    reaction: string,
  ): Promise<Result<ReactionSent, SignetError>>;

  /** List conversations visible to this session. */
  listConversations(): Promise<Result<Conversation[], SignetError>>;

  /** Get detailed info about a conversation. */
  getConversationInfo(
    groupId: string,
  ): Promise<Result<ConversationInfo, SignetError>>;

  /** Current session info. */
  readonly session: SessionInfo | null;

  /** Current connection state. */
  readonly state: HandlerState;

  /** Register a listener for state changes. Returns unsubscribe. */
  onStateChange(callback: StateChangeCallback): () => void;

  /** Register a listener for errors. Returns unsubscribe. */
  onError(callback: ErrorCallback): () => void;
}
