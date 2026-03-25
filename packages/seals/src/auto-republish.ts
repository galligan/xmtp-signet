import { Result } from "better-result";
import {
  ValidationError,
  type SealEnvelopeType,
  type SignetError,
} from "@xmtp/signet-schemas";

/** Callback to republish a seal to a specific chat. */
export type SealRepublisher = (
  chatId: string,
  seal: SealEnvelopeType,
) => Promise<Result<void, SignetError>>;

/** Configuration for auto-republish retry behavior. */
export interface AutoRepublishConfig {
  /** Maximum retry attempts per chat. Default: 3. */
  readonly maxRetries?: number;
  /** Initial retry delay in ms. Doubles on each retry. Default: 1000. */
  readonly initialDelayMs?: number;
}

/** Per-chat outcome when republish fails after all retries. */
export interface RepublishFailure {
  readonly chatId: string;
  readonly error: SignetError;
}

/** Aggregate result of republishing a seal to multiple chats. */
export interface RepublishResult {
  readonly succeeded: string[];
  readonly failed: readonly RepublishFailure[];
}

/**
 * Republish a seal to all affected chats with exponential backoff retry.
 *
 * Each chat is attempted independently. A failure in one chat does not
 * prevent attempts to the others. Returns which chats succeeded and
 * which failed after exhausting all retries.
 */
export async function republishToChats(
  chatIds: readonly string[],
  seal: SealEnvelopeType,
  publish: SealRepublisher,
  config?: AutoRepublishConfig,
): Promise<RepublishResult> {
  const maxRetries = config?.maxRetries ?? 3;
  const initialDelay = config?.initialDelayMs ?? 1000;

  const succeeded: string[] = [];
  const failed: RepublishFailure[] = [];

  for (const chatId of chatIds) {
    if (seal.chain.current.chatId !== chatId) {
      failed.push({
        chatId,
        error: ValidationError.create(
          "chatId",
          "Seal chatId does not match target chat",
          {
            expectedChatId: seal.chain.current.chatId,
            targetChatId: chatId,
          },
        ),
      });
      continue;
    }

    let lastError: SignetError | undefined;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }

      const result = await publish(chatId, seal);
      if (Result.isOk(result)) {
        succeeded.push(chatId);
        lastError = undefined;
        break;
      }
      lastError = result.error;
    }

    if (lastError !== undefined) {
      failed.push({ chatId, error: lastError });
    }
  }

  return { succeeded, failed };
}
