/**
 * Mock XmtpClientFactory for integration tests.
 *
 * Returns mock clients that can be controlled externally.
 */

import { Result } from "better-result";
import type {
  XmtpClientFactory,
  XmtpClientCreateOptions,
  XmtpDecodedMessage,
  XmtpGroupEvent,
} from "@xmtp/signet-core";
import {
  createMockXmtpClient,
  type MockXmtpClient,
  type MockXmtpClientOptions,
} from "./mock-xmtp-client.js";

/** Mock XMTP client factory used by integration tests. */
export interface MockXmtpClientFactory extends XmtpClientFactory {
  /** Access created clients by identity ID. */
  readonly clients: ReadonlyMap<string, MockXmtpClient>;
}

/** Fan-out emitters for all clients created by the factory. */
export interface MockFactoryStreams {
  /** Emit a message on all active client streams. */
  readonly emitMessage: (msg: XmtpDecodedMessage) => void;
  /** Emit a group event on all active client streams. */
  readonly emitGroupEvent: (event: XmtpGroupEvent) => void;
}

/** Create a factory that returns controllable mock XMTP clients. */
export function createMockXmtpClientFactory(
  defaultOptions?: MockXmtpClientOptions,
): {
  factory: MockXmtpClientFactory;
  streams: MockFactoryStreams;
} {
  const clients = new Map<string, MockXmtpClient>();
  const allEmitters: Array<{
    emitMessage: (msg: XmtpDecodedMessage) => void;
    emitGroupEvent: (event: XmtpGroupEvent) => void;
  }> = [];

  const factory: MockXmtpClientFactory = {
    get clients() {
      return clients;
    },

    async create(options: XmtpClientCreateOptions) {
      const { client, streams } = createMockXmtpClient({
        inboxId: defaultOptions?.inboxId ?? `inbox_${options.identityId}`,
        ...(defaultOptions?.groups ? { groups: defaultOptions.groups } : {}),
      });
      clients.set(options.identityId, client);
      allEmitters.push(streams);
      return Result.ok(client);
    },
  };

  return {
    factory,
    streams: {
      emitMessage(msg) {
        for (const e of allEmitters) {
          e.emitMessage(msg);
        }
      },
      emitGroupEvent(event) {
        for (const e of allEmitters) {
          e.emitGroupEvent(event);
        }
      },
    },
  };
}
