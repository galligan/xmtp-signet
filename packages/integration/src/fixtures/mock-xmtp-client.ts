/**
 * Mock XmtpClient for integration tests.
 *
 * Provides an in-memory implementation of the XmtpClient interface
 * that records operations and allows test control of message/group streams.
 */

import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type {
  XmtpClient,
  XmtpGroupInfo,
  XmtpDecodedMessage,
  XmtpGroupEvent,
  MessageStream,
  GroupStream,
} from "@xmtp/signet-core";

/** Options for constructing a mock XMTP client. */
export interface MockXmtpClientOptions {
  readonly inboxId?: string;
  readonly groups?: readonly XmtpGroupInfo[];
}

/** In-memory XMTP client used by integration tests. */
export interface MockXmtpClient extends XmtpClient {
  /** Messages sent via sendMessage(). */
  readonly sentMessages: ReadonlyArray<{
    groupId: string;
    content: unknown;
  }>;
  /** Members added via addMembers(). */
  readonly addedMembers: ReadonlyArray<{
    groupId: string;
    inboxIds: readonly string[];
  }>;
  /** Members removed via removeMembers(). */
  readonly removedMembers: ReadonlyArray<{
    groupId: string;
    inboxIds: readonly string[];
  }>;
}

/**
 * Creates an async iterable that can be externally pushed to and aborted.
 */
function createControllableStream<T>(): {
  iterable: AsyncIterable<T>;
  push: (item: T) => void;
  abort: () => void;
} {
  const queue: T[] = [];
  let resolve: ((value: IteratorResult<T>) => void) | null = null;
  let done = false;

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          const queued = queue.shift();
          if (queued !== undefined) {
            return Promise.resolve({ value: queued, done: false });
          }
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as T,
              done: true,
            });
          }
          return new Promise<IteratorResult<T>>((res) => {
            resolve = res;
          });
        },
      };
    },
  };

  return {
    iterable,
    push(item: T) {
      if (done) return;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: item, done: false });
      } else {
        queue.push(item);
      }
    },
    abort() {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: undefined as unknown as T, done: true });
      }
    },
  };
}

/** Stream emitters exposed by the mock client. */
export interface MockStreams {
  readonly emitMessage: (msg: XmtpDecodedMessage) => void;
  readonly emitGroupEvent: (event: XmtpGroupEvent) => void;
}

/** Create a controllable in-memory XMTP client. */
export function createMockXmtpClient(options?: MockXmtpClientOptions): {
  client: MockXmtpClient;
  streams: MockStreams;
} {
  const inboxId = options?.inboxId ?? `inbox_${crypto.randomUUID()}`;
  const groups = new Map<string, XmtpGroupInfo>(
    (options?.groups ?? []).map((g) => [g.groupId, g]),
  );

  const sentMessages: Array<{ groupId: string; content: unknown }> = [];
  const addedMembers: Array<{
    groupId: string;
    inboxIds: readonly string[];
  }> = [];
  const removedMembers: Array<{
    groupId: string;
    inboxIds: readonly string[];
  }> = [];

  const msgStream = createControllableStream<XmtpDecodedMessage>();
  const grpStream = createControllableStream<XmtpGroupEvent>();

  const client: MockXmtpClient = {
    inboxId,

    get sentMessages() {
      return sentMessages;
    },
    get addedMembers() {
      return addedMembers;
    },
    get removedMembers() {
      return removedMembers;
    },

    async sendMessage(groupId, content) {
      sentMessages.push({ groupId, content });
      return Result.ok(`msg_${crypto.randomUUID()}`);
    },

    async createDm(peerInboxId) {
      return Result.ok({ dmId: `dm_${crypto.randomUUID()}`, peerInboxId });
    },

    async sendDmMessage(_dmId, _text) {
      return Result.ok(`dm_msg_${crypto.randomUUID()}`);
    },

    async syncAll() {
      return Result.ok(undefined);
    },

    async syncGroup(_groupId) {
      return Result.ok(undefined);
    },

    async getGroupInfo(groupId) {
      const info = groups.get(groupId);
      if (!info) {
        return Result.err(NotFoundError.create("group", groupId));
      }
      return Result.ok(info);
    },

    async listGroups() {
      return Result.ok([...groups.values()]);
    },

    async createGroup(memberInboxIds, opts) {
      const groupId = `group_${crypto.randomUUID()}`;
      const info: XmtpGroupInfo = {
        groupId,
        name: opts?.name ?? "",
        description: "",
        memberInboxIds: [inboxId, ...memberInboxIds],
        createdAt: new Date().toISOString(),
      };
      groups.set(groupId, info);
      return Result.ok(info);
    },

    async addMembers(groupId, inboxIds) {
      addedMembers.push({ groupId, inboxIds });
      return Result.ok(undefined);
    },

    async removeMembers(groupId, inboxIds) {
      removedMembers.push({ groupId, inboxIds });
      return Result.ok(undefined);
    },

    async listMessages(_groupId: string) {
      return Result.ok([] as readonly XmtpDecodedMessage[]);
    },

    async streamAllMessages() {
      const stream: MessageStream = {
        messages: msgStream.iterable,
        abort: msgStream.abort,
      };
      return Result.ok(stream);
    },

    async streamGroups() {
      const stream: GroupStream = {
        groups: grpStream.iterable,
        abort: grpStream.abort,
      };
      return Result.ok(stream);
    },
  };

  return {
    client,
    streams: {
      emitMessage: msgStream.push,
      emitGroupEvent: grpStream.push,
    },
  };
}
