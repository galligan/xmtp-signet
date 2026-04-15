import type {
  MessageStream,
  DmStream,
  XmtpDmEvent,
  GroupStream,
  XmtpDecodedMessage,
  XmtpGroupEvent,
} from "../xmtp-client-factory.js";
import { toDecodedMessage } from "./type-mapping.js";
import type { DecodedMessageLike } from "./type-mapping.js";

/**
 * Shape of an SDK AsyncStreamProxy (structural, no SDK import).
 */
export interface AsyncStreamProxyLike<T> extends AsyncIterable<T> {
  return(): Promise<{ value: undefined; done: boolean }>;
}

/**
 * Shape of a group object needed for stream mapping.
 */
interface GroupStreamItem {
  readonly id: string;
  readonly name: string;
}

/**
 * Shape of a DM object needed for stream mapping.
 */
interface DmStreamItem {
  readonly id: string;
  readonly peerInboxId: string;
}

/**
 * Wraps an SDK message stream into signet's MessageStream type
 * with abort support.
 */
export function wrapMessageStream(
  sdkStream: AsyncStreamProxyLike<DecodedMessageLike>,
): MessageStream {
  const abortController = new AbortController();

  const messages: AsyncIterable<XmtpDecodedMessage> = {
    async *[Symbol.asyncIterator]() {
      for await (const msg of sdkStream) {
        if (abortController.signal.aborted) break;
        yield toDecodedMessage(msg);
      }
    },
  };

  return {
    messages,
    abort: () => {
      abortController.abort();
      sdkStream.return().catch(() => {});
    },
  };
}

/**
 * Wraps an SDK group stream into signet's GroupStream type
 * with abort support.
 */
export function wrapGroupStream(
  sdkStream: AsyncStreamProxyLike<GroupStreamItem>,
): GroupStream {
  const abortController = new AbortController();

  const groups: AsyncIterable<XmtpGroupEvent> = {
    async *[Symbol.asyncIterator]() {
      for await (const group of sdkStream) {
        if (abortController.signal.aborted) break;
        yield {
          groupId: group.id,
          groupName: group.name,
        };
      }
    },
  };

  return {
    groups,
    abort: () => {
      abortController.abort();
      sdkStream.return().catch(() => {});
    },
  };
}

/**
 * Wraps an SDK DM stream into signet's DmStream type
 * with abort support.
 */
export function wrapDmStream(
  sdkStream: AsyncStreamProxyLike<DmStreamItem>,
): DmStream {
  const abortController = new AbortController();

  const dms: AsyncIterable<XmtpDmEvent> = {
    async *[Symbol.asyncIterator]() {
      for await (const dm of sdkStream) {
        if (abortController.signal.aborted) break;
        yield {
          dmId: dm.id,
          peerInboxId: dm.peerInboxId,
        };
      }
    },
  };

  return {
    dms,
    abort: () => {
      abortController.abort();
      sdkStream.return().catch(() => {});
    },
  };
}
