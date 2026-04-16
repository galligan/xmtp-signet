import { Result } from "better-result";
import {
  tryProcessJoinRequest,
  isJoinRequestContentType,
  type CoreRawEvent,
  type ListMessagesOptions,
  type RawMessageEvent,
  type JoinRequestResult,
  type XmtpDecodedMessage,
} from "@xmtp/signet-core";
import type { SignetError } from "@xmtp/signet-schemas";

interface ManagedInviteHostClient {
  readonly addMembers: (
    groupId: string,
    inboxIds: readonly string[],
  ) => Promise<Result<void, SignetError>>;
  readonly listMessages: (
    groupId: string,
    options?: ListMessagesOptions,
  ) => Promise<Result<readonly XmtpDecodedMessage[], SignetError>>;
}

interface ManagedInviteHostIdentity {
  readonly id: string;
  readonly inboxId: string | null;
}

/** Dependencies required to resolve the correct managed identity for an invite. */
export interface ManagedInviteHostListenerDeps {
  /** Subscribe to raw core events and return an unsubscribe callback. */
  readonly subscribe: (handler: (event: CoreRawEvent) => void) => () => void;
  /** List the managed identities currently known to the signet. */
  readonly listIdentities: () => Promise<readonly ManagedInviteHostIdentity[]>;
  /** Resolve the XMTP wallet private key for a managed identity. */
  readonly getWalletPrivateKeyHex: (
    identityId: string,
  ) => Promise<Result<string, SignetError>>;
  /** Resolve the managed client that can mutate group membership. */
  readonly getManagedClient: (
    identityId: string,
  ) => ManagedInviteHostClient | undefined;
  /** Load the invite tag that was stored when the invite link was generated. */
  readonly getGroupInviteTag: (
    groupId: string,
  ) => Promise<Result<string | undefined, SignetError>>;
}

const RECENT_JOIN_SCAN_OPTIONS = {
  limit: 10,
  direction: "descending",
} satisfies ListMessagesOptions;
const DM_RECOVERY_RETRY_DELAY_MS = 250;
const MAX_DM_RECOVERY_RETRIES = 3;

interface InviteRecoveryScanResult {
  readonly messages: readonly RawMessageEvent[];
  readonly shouldRetry: boolean;
}

function isInviteCandidate(event: CoreRawEvent): event is RawMessageEvent {
  if (event.type !== "raw.message") return false;
  if (event.isHistorical) return false;
  if (isJoinRequestContentType(event.contentType)) {
    return true;
  }
  if (typeof event.content !== "string") return false;

  const text = event.content.trim();
  return text.length >= 50 && !text.includes(" ");
}

function normalizePrivateKeyHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function toRawMessageEvent(message: XmtpDecodedMessage): RawMessageEvent {
  return {
    type: "raw.message",
    messageId: message.messageId,
    groupId: message.groupId,
    senderInboxId: message.senderInboxId,
    contentType: message.contentType,
    content: message.content,
    sentAt: message.sentAt,
    threadId: message.threadId,
    isHistorical: false,
  };
}

/**
 * Attempt to process an invite join request by trying each managed identity
 * with a registered inbox ID until one validates the invite successfully.
 */
export async function dispatchInviteJoinRequestAcrossManagedIdentities(
  deps: ManagedInviteHostListenerDeps,
  event: CoreRawEvent,
): Promise<Result<JoinRequestResult, SignetError> | null> {
  if (!isInviteCandidate(event)) return null;

  const identities = await deps.listIdentities();
  let lastError: SignetError | null = null;

  for (const identity of identities) {
    if (!identity.inboxId) continue;

    const managed = deps.getManagedClient(identity.id);
    if (!managed) continue;

    const keyResult = await deps.getWalletPrivateKeyHex(identity.id);
    if (Result.isError(keyResult)) continue;

    const result = await tryProcessJoinRequest(
      {
        walletPrivateKeyHex: normalizePrivateKeyHex(keyResult.value),
        creatorInboxId: identity.inboxId,
        addMembersToGroup: (groupId, inboxIds) =>
          managed.addMembers(groupId, inboxIds),
        getGroupInviteTag: deps.getGroupInviteTag,
      },
      event,
    );

    if (result === null) return null;
    if (Result.isOk(result)) return result;
    lastError = result.error;
  }

  return lastError ? Result.err(lastError) : null;
}

async function listRecentInviteCandidatesAcrossManagedIdentities(
  deps: ManagedInviteHostListenerDeps,
  conversationId: string,
  processedMessageIds: ReadonlySet<string>,
): Promise<InviteRecoveryScanResult> {
  const identities = await deps.listIdentities();
  const messages = new Map<string, RawMessageEvent>();
  let shouldRetry = false;

  for (const identity of identities) {
    const managed = deps.getManagedClient(identity.id);
    if (!managed) continue;

    let before: string | undefined;

    while (true) {
      const listOptions = before
        ? { ...RECENT_JOIN_SCAN_OPTIONS, before }
        : RECENT_JOIN_SCAN_OPTIONS;
      const listResult = await managed.listMessages(
        conversationId,
        listOptions,
      );
      if (Result.isError(listResult)) {
        if (listResult.error.category === "not_found") {
          break;
        }
        shouldRetry = true;
        break;
      }
      if (listResult.value.length === 0) break;

      for (const message of [...listResult.value].reverse()) {
        const event = toRawMessageEvent(message);
        if (!isInviteCandidate(event)) continue;
        if (processedMessageIds.has(event.messageId)) continue;
        messages.set(event.messageId, event);
      }

      if (listResult.value.length < RECENT_JOIN_SCAN_OPTIONS.limit) break;

      const oldestMessage = listResult.value[listResult.value.length - 1];
      before = oldestMessage?.sentAt;
      if (!before) break;
    }
  }

  return {
    messages: [...messages.values()],
    shouldRetry,
  };
}

async function processInviteCandidate(
  deps: ManagedInviteHostListenerDeps,
  event: RawMessageEvent,
  processedMessageIds: Set<string>,
  inflightMessageIds: Set<string>,
): Promise<boolean> {
  if (processedMessageIds.has(event.messageId)) return true;
  if (inflightMessageIds.has(event.messageId)) return true;

  inflightMessageIds.add(event.messageId);

  try {
    const result = await dispatchInviteJoinRequestAcrossManagedIdentities(
      deps,
      event,
    );
    if (result !== null && Result.isOk(result)) {
      processedMessageIds.add(event.messageId);
      return true;
    }
    return false;
  } finally {
    inflightMessageIds.delete(event.messageId);
  }
}

/**
 * Subscribe to raw core events and process invite join requests by trying
 * each managed identity with a registered inbox ID until one validates.
 */
export function startManagedInviteHostListener(
  deps: ManagedInviteHostListenerDeps,
): () => void {
  const processedMessageIds = new Set<string>();
  const inflightMessageIds = new Set<string>();
  const recoveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearRecoveryRetryTimer(dmId: string): void {
    const timer = recoveryRetryTimers.get(dmId);
    if (timer === undefined) return;
    clearTimeout(timer);
    recoveryRetryTimers.delete(dmId);
  }

  function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    if (typeof timer !== "object" || timer === null || !("unref" in timer)) {
      return;
    }
    const unref = timer.unref;
    if (typeof unref === "function") {
      unref.call(timer);
    }
  }

  async function recoverInviteCandidatesFromDm(
    dmId: string,
    retryCount = 0,
  ): Promise<void> {
    const scanResult = await listRecentInviteCandidatesAcrossManagedIdentities(
      deps,
      dmId,
      processedMessageIds,
    );
    let shouldRetry = scanResult.shouldRetry;

    for (const message of scanResult.messages) {
      const processed = await processInviteCandidate(
        deps,
        message,
        processedMessageIds,
        inflightMessageIds,
      );
      if (!processed) {
        shouldRetry = true;
      }
    }

    if (
      !shouldRetry ||
      retryCount >= MAX_DM_RECOVERY_RETRIES ||
      recoveryRetryTimers.has(dmId)
    ) {
      return;
    }

    const timer = setTimeout(() => {
      recoveryRetryTimers.delete(dmId);
      void recoverInviteCandidatesFromDm(dmId, retryCount + 1);
    }, DM_RECOVERY_RETRY_DELAY_MS);
    unrefTimer(timer);
    recoveryRetryTimers.set(dmId, timer);
  }

  const unsubscribe = deps.subscribe((event) => {
    void (async () => {
      if (event.type === "raw.message") {
        if (!isInviteCandidate(event)) return;
        await processInviteCandidate(
          deps,
          event,
          processedMessageIds,
          inflightMessageIds,
        );
        return;
      }

      if (event.type !== "raw.dm.joined") return;

      await recoverInviteCandidatesFromDm(event.dmId);
    })().catch(() => {
      // Ignore invite-processing failures so the raw event stream stays hot.
    });
  });

  return () => {
    for (const dmId of recoveryRetryTimers.keys()) {
      clearRecoveryRetryTimer(dmId);
    }
    unsubscribe();
  };
}
