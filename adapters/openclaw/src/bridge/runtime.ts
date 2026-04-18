import { Result } from "better-result";
import {
  AuthError,
  InternalError,
  ValidationError,
  type SignetError,
} from "@xmtp/signet-schemas";
import {
  AuthenticatedFrame,
  AuthErrorFrame,
  BackpressureFrame,
  SequencedFrame,
  WS_CLOSE_CODES,
} from "@xmtp/signet-ws";
import type { OpenClawBridgeEnvelopeType } from "./envelope.js";
import { createOpenClawBridgeEnvelope } from "./envelope.js";
import type { OpenClawBridgeCheckpointType } from "./checkpoint-store.js";
import { createOpenClawCheckpointStore } from "./checkpoint-store.js";
import {
  OpenClawBridgeConfig,
  resolveResumeSeq,
  type OpenClawBridgeConfigType,
} from "./config.js";

/** Runtime lifecycle states for the read-only OpenClaw bridge. */
export type OpenClawBridgeState =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "closed";

/** Observable counters and checkpoints for the bridge runtime. */
export interface OpenClawBridgeMetrics {
  readonly connectionAttempts: number;
  readonly reconnectCount: number;
  readonly deliveredCount: number;
  readonly dedupedCount: number;
  readonly lastSeq: number | null;
  readonly lastEventType: string | null;
  readonly credentialId: string | null;
  readonly operatorId: string | null;
  readonly checkpointPath: string | null;
  readonly lastError: string | null;
}

/** Public runtime contract for the first read-only OpenClaw bridge. */
export interface OpenClawReadOnlyBridge {
  start(): Promise<Result<void, SignetError>>;
  stop(): Promise<void>;
  readonly deliveries: AsyncIterable<OpenClawBridgeEnvelopeType>;
  readonly state: OpenClawBridgeState;
  readonly metrics: OpenClawBridgeMetrics;
  onError(callback: (error: SignetError) => void): () => void;
}

type BridgeOutcome =
  | {
      retryable: true;
      lastCheckpoint: OpenClawBridgeCheckpointType | null;
    }
  | {
      retryable: false;
      lastCheckpoint: OpenClawBridgeCheckpointType | null;
      error: SignetError;
    };

interface EnvelopeStream extends AsyncIterable<OpenClawBridgeEnvelopeType> {
  push(value: OpenClawBridgeEnvelopeType): void;
  complete(): void;
}

const NON_RETRYABLE_CODES = new Set<number>([
  WS_CLOSE_CODES.AUTH_FAILED,
  WS_CLOSE_CODES.AUTH_TIMEOUT,
  WS_CLOSE_CODES.CREDENTIAL_REVOKED,
  WS_CLOSE_CODES.PROTOCOL_ERROR,
]);

function isRetryableClose(code: number): boolean {
  return !NON_RETRYABLE_CODES.has(code);
}

function createEnvelopeStream(): EnvelopeStream {
  const queue: OpenClawBridgeEnvelopeType[] = [];
  let done = false;
  let waiter:
    | ((result: IteratorResult<OpenClawBridgeEnvelopeType>) => void)
    | null = null;

  return {
    push(value) {
      if (done) {
        return;
      }
      if (waiter !== null) {
        const resolve = waiter;
        waiter = null;
        resolve({ value, done: false });
        return;
      }
      queue.push(value);
    },

    complete() {
      done = true;
      if (waiter !== null) {
        const resolve = waiter;
        waiter = null;
        resolve({
          value: undefined as unknown as OpenClawBridgeEnvelopeType,
          done: true,
        });
      }
    },

    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<OpenClawBridgeEnvelopeType>> {
          const buffered = queue.shift();
          if (buffered !== undefined) {
            return Promise.resolve({ value: buffered, done: false });
          }
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as OpenClawBridgeEnvelopeType,
              done: true,
            });
          }
          return new Promise((resolve) => {
            waiter = resolve;
          });
        },
      };
    },
  };
}

function reconnectDelay(
  attempt: number,
  config: OpenClawBridgeConfigType["reconnect"],
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, config.maxDelayMs);
  if (config.jitter) {
    return Math.floor(Math.random() * (capped + 1));
  }
  return capped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function decodeSocketPayload(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return await data.text();
  }
  return String(data);
}

/** Create the first read-only OpenClaw bridge runtime. */
export function createOpenClawReadOnlyBridge(
  rawConfig: OpenClawBridgeConfigType,
): OpenClawReadOnlyBridge {
  const config = OpenClawBridgeConfig.parse(rawConfig);
  const checkpoints = createOpenClawCheckpointStore(config);
  const deliveries = createEnvelopeStream();
  const errorListeners = new Set<(error: SignetError) => void>();
  let bridgeState: OpenClawBridgeState = "idle";
  let ws: WebSocket | null = null;
  let stopped = false;
  let loop: Promise<void> | null = null;
  let metricsState: OpenClawBridgeMetrics = {
    connectionAttempts: 0,
    reconnectCount: 0,
    deliveredCount: 0,
    dedupedCount: 0,
    lastSeq: null,
    lastEventType: null,
    credentialId: null,
    operatorId: null,
    checkpointPath: null,
    lastError: null,
  };

  function emitError(error: SignetError): void {
    metricsState = {
      ...metricsState,
      lastError: error.message,
    };
    for (const listener of errorListeners) {
      listener(error);
    }
  }

  async function connectAndPump(
    resumeCheckpoint: OpenClawBridgeCheckpointType | null,
    onAuthenticated: (checkpoint: OpenClawBridgeCheckpointType | null) => void,
  ): Promise<BridgeOutcome> {
    metricsState = {
      ...metricsState,
      connectionAttempts: metricsState.connectionAttempts + 1,
    };
    bridgeState = "connecting";

    const resumeSeq = resolveResumeSeq(resumeCheckpoint);

    return new Promise((resolve) => {
      const socket = new WebSocket(config.wsUrl);
      ws = socket;
      let authenticated = false;
      let settled = false;
      let currentCheckpoint = resumeCheckpoint;
      let lastDeliveredSeq = resumeSeq ?? 0;
      let credentialId = resumeCheckpoint?.credentialId ?? null;
      let operatorId: string | null = null;
      let frameChain = Promise.resolve();

      function settle(outcome: BridgeOutcome): void {
        if (settled) {
          return;
        }
        settled = true;
        resolve(outcome);
      }

      const authTimeout = setTimeout(() => {
        if (authenticated || settled) {
          return;
        }
        socket.close(WS_CLOSE_CODES.AUTH_TIMEOUT, "Auth timeout");
        settle({
          retryable: false,
          lastCheckpoint: currentCheckpoint,
          error: AuthError.create("Auth response not received from signet"),
        });
      }, 30_000);

      async function handleSequencedFrame(rawFrame: unknown): Promise<void> {
        const frameResult = SequencedFrame.safeParse(rawFrame);
        if (!frameResult.success) {
          const error = ValidationError.create(
            "bridge.frame",
            "Received invalid sequenced frame from signet",
            {
              issues: frameResult.error.issues.map(
                (issue: { readonly message: string }) => issue.message,
              ),
            },
          );
          emitError(error);
          return;
        }

        const frame = frameResult.data;
        if (credentialId === null || operatorId === null) {
          const error = InternalError.create(
            "Sequenced frame arrived before bridge authentication completed",
          );
          emitError(error);
          return;
        }

        if (frame.seq <= lastDeliveredSeq) {
          metricsState = {
            ...metricsState,
            dedupedCount: metricsState.dedupedCount + 1,
          };
          return;
        }

        const checkpointPath = checkpoints.pathForCredential(credentialId);
        const envelope = createOpenClawBridgeEnvelope({
          credentialId,
          operatorId,
          seq: frame.seq,
          checkpointPath,
          event: frame.event,
        });
        currentCheckpoint = {
          credentialId,
          lastSeq: frame.seq,
          updatedAt: new Date().toISOString(),
        };
        lastDeliveredSeq = frame.seq;
        metricsState = {
          ...metricsState,
          deliveredCount: metricsState.deliveredCount + 1,
          lastSeq: frame.seq,
          lastEventType: frame.event.type,
          credentialId,
          operatorId,
          checkpointPath,
        };
        deliveries.push(envelope);

        const saveResult = await checkpoints.save(currentCheckpoint);
        if (saveResult.isErr()) {
          emitError(saveResult.error);
          return;
        }

        metricsState = {
          ...metricsState,
          checkpointPath: saveResult.value,
        };
      }

      socket.addEventListener("open", () => {
        bridgeState = "authenticating";
        socket.send(
          JSON.stringify({
            type: "auth",
            token: config.token,
            lastSeenSeq: resumeSeq,
          }),
        );
      });

      socket.addEventListener("message", (message) => {
        void (async () => {
          const rawText = await decodeSocketPayload(message.data);

          let payload: unknown;
          try {
            payload = JSON.parse(rawText);
          } catch {
            emitError(
              ValidationError.create(
                "bridge.frame",
                "Bridge received non-JSON data from signet",
              ),
            );
            return;
          }

          if (!authenticated) {
            const authenticatedResult = AuthenticatedFrame.safeParse(payload);
            if (authenticatedResult.success) {
              authenticated = true;
              clearTimeout(authTimeout);
              credentialId = authenticatedResult.data.credential.credentialId;
              operatorId = authenticatedResult.data.credential.operatorId;
              bridgeState = "connected";
              metricsState = {
                ...metricsState,
                credentialId,
                operatorId,
                checkpointPath: checkpoints.pathForCredential(credentialId),
              };
              onAuthenticated(currentCheckpoint);
              return;
            }

            const authErrorResult = AuthErrorFrame.safeParse(payload);
            if (authErrorResult.success) {
              clearTimeout(authTimeout);
              const error = AuthError.create(authErrorResult.data.message, {
                code: authErrorResult.data.code,
              });
              emitError(error);
              settle({
                retryable: false,
                lastCheckpoint: currentCheckpoint,
                error,
              });
              return;
            }
          }

          const backpressureResult = BackpressureFrame.safeParse(payload);
          if (backpressureResult.success) {
            emitError(
              InternalError.create("OpenClaw bridge hit signet backpressure", {
                buffered: backpressureResult.data.buffered,
                limit: backpressureResult.data.limit,
              }),
            );
            return;
          }

          frameChain = frameChain
            .then(async () => handleSequencedFrame(payload))
            .catch((error) => {
              emitError(
                InternalError.create(
                  "OpenClaw bridge frame processing failed",
                  {
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                ),
              );
            });
        })();
      });

      socket.addEventListener("close", (event) => {
        clearTimeout(authTimeout);
        void frameChain.finally(() => {
          ws = null;

          if (stopped) {
            bridgeState = "closed";
            settle({
              retryable: false,
              lastCheckpoint: currentCheckpoint,
              error: ValidationError.create("bridge.state", "Bridge stopped"),
            });
            return;
          }

          if (!isRetryableClose(event.code)) {
            const error = AuthError.create(
              event.reason || "Bridge connection closed by signet",
              {
                code: event.code,
              },
            );
            emitError(error);
            bridgeState = "closed";
            settle({
              retryable: false,
              lastCheckpoint: currentCheckpoint,
              error,
            });
            return;
          }

          bridgeState = "reconnecting";
          settle({
            retryable: true,
            lastCheckpoint: currentCheckpoint,
          });
        });
      });

      socket.addEventListener("error", () => {
        // Close handling owns reconnect/error decisions.
      });
    });
  }

  async function runLoop(
    onInitialResult: (result: Result<void, SignetError>) => void,
  ): Promise<void> {
    const latestCheckpointResult = await checkpoints.loadLatest();
    if (latestCheckpointResult.isErr()) {
      emitError(latestCheckpointResult.error);
      onInitialResult(Result.err(latestCheckpointResult.error));
      bridgeState = "closed";
      deliveries.complete();
      return;
    }

    let resumeCheckpoint = latestCheckpointResult.value;
    let attempt = 0;
    let initialResolved = false;

    while (!stopped) {
      const outcome = await connectAndPump(resumeCheckpoint, (checkpoint) => {
        resumeCheckpoint = checkpoint;
        attempt = 0;
        if (!initialResolved) {
          initialResolved = true;
          onInitialResult(Result.ok(undefined));
        }
      });
      resumeCheckpoint = outcome.lastCheckpoint;
      if (!initialResolved && !outcome.retryable) {
        initialResolved = true;
        onInitialResult(Result.err(outcome.error));
      }

      if (stopped) {
        break;
      }

      if (!outcome.retryable) {
        bridgeState = "closed";
        deliveries.complete();
        return;
      }

      if (!config.reconnect.enabled) {
        const error = InternalError.create(
          "OpenClaw bridge reconnect is disabled",
        );
        emitError(error);
        bridgeState = "closed";
        deliveries.complete();
        return;
      }

      if (
        config.reconnect.maxAttempts !== 0 &&
        attempt >= config.reconnect.maxAttempts
      ) {
        const error = InternalError.create(
          "OpenClaw bridge exhausted reconnect attempts",
          {
            maxAttempts: config.reconnect.maxAttempts,
          },
        );
        emitError(error);
        bridgeState = "closed";
        deliveries.complete();
        return;
      }

      metricsState = {
        ...metricsState,
        reconnectCount: metricsState.reconnectCount + 1,
      };
      bridgeState = "reconnecting";
      const delay = reconnectDelay(attempt, config.reconnect);
      attempt += 1;
      await sleep(delay);
    }

    bridgeState = "closed";
    deliveries.complete();
  }

  return {
    async start() {
      if (loop !== null) {
        return Result.err(
          ValidationError.create(
            "bridge.state",
            "OpenClaw bridge is already running",
          ),
        );
      }

      stopped = false;
      return await new Promise<Result<void, SignetError>>((resolve) => {
        loop = runLoop(resolve);
      });
    },

    async stop() {
      stopped = true;
      if (ws !== null) {
        ws.close(WS_CLOSE_CODES.NORMAL, "Bridge stopping");
      }
      await loop;
      loop = null;
    },

    get deliveries() {
      return deliveries;
    },

    get state() {
      return bridgeState;
    },

    get metrics() {
      return metricsState;
    },

    onError(callback) {
      errorListeners.add(callback);
      return () => {
        errorListeners.delete(callback);
      };
    },
  };
}
