/**
 * WebSocket test client with typed helpers for integration tests.
 */

/** Convenience wrapper around a WebSocket connection in tests. */
export interface TestWsClient {
  readonly ws: WebSocket;
  /** Wait for the next JSON message. */
  nextMessage: (timeoutMs?: number) => Promise<unknown>;
  /** Send a JSON frame. */
  send: (data: unknown) => void;
  /** Close the connection. */
  close: () => Promise<void>;
  /** Drain all messages received so far. */
  drain: () => unknown[];
}

/**
 * Connect a WebSocket to the test server, optionally sending auth.
 */
export function connectTestClient(
  port: number,
  options?: { token?: string; lastSeenSeq?: number | null },
): Promise<TestWsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/agent`);
    const messages: unknown[] = [];
    const waiters: Array<{
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
    }> = [];

    ws.addEventListener("message", (event) => {
      const data: unknown = JSON.parse(
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer),
      );
      const waiter = waiters.shift();
      if (waiter) {
        waiter.resolve(data);
      } else {
        messages.push(data);
      }
    });

    ws.addEventListener("error", (event) => {
      reject(new Error(`WebSocket error: ${String(event)}`));
    });

    ws.addEventListener("open", () => {
      const client: TestWsClient = {
        ws,

        nextMessage(timeoutMs = 5_000) {
          const queued = messages.shift();
          if (queued !== undefined) {
            return Promise.resolve(queued);
          }
          return new Promise<unknown>((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.resolve === res);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error("Timed out waiting for message"));
            }, timeoutMs);
            waiters.push({
              resolve: (v) => {
                clearTimeout(timer);
                res(v);
              },
              reject: (e) => {
                clearTimeout(timer);
                rej(e);
              },
            });
          });
        },

        send(data) {
          ws.send(JSON.stringify(data));
        },

        async close() {
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close();
            await new Promise<void>((res) => {
              ws.addEventListener("close", () => res());
            });
          }
        },

        drain() {
          const drained = [...messages];
          messages.length = 0;
          return drained;
        },
      };

      // Auto-send auth if token provided
      if (options?.token) {
        client.send({
          type: "auth",
          token: options.token,
          lastSeenSeq: options.lastSeenSeq ?? null,
        });
      }

      resolve(client);
    });
  });
}

/**
 * Connect and authenticate, returning only after the authenticated frame.
 */
export async function connectAndAuth(
  port: number,
  token: string,
  lastSeenSeq?: number | null,
): Promise<{ client: TestWsClient; authFrame: Record<string, unknown> }> {
  const client = await connectTestClient(port, {
    token,
    lastSeenSeq: lastSeenSeq ?? null,
  });
  const authFrame = (await client.nextMessage()) as Record<string, unknown>;
  if (authFrame["type"] !== "authenticated") {
    throw new Error(
      `Expected authenticated frame, got: ${JSON.stringify(authFrame)}`,
    );
  }
  return { client, authFrame };
}
