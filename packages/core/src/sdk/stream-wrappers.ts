import type {
  MessageStream,
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
