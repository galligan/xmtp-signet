import { Result } from "better-result";
import {
  createConvosOnboardingScheme,
  extractJoinRequestContent,
  type CoreRawEvent,
  type JoinRequestResult,
  type ListMessagesOptions,
  type OnboardingScheme,
  type RawMessageEvent,
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

interface ManagedInviteJoinResolution {
  readonly join: JoinRequestResult;
  readonly hostIdentityId: string;
  readonly hostInboxId: string;
}

interface ManagedInviteJoinDispatchOutcome {
  readonly result: Result<ManagedInviteJoinResolution, SignetError> | null;
  readonly shouldRetry: boolean;
}

/** Successful join resolution plus the raw request message that triggered it. */
export interface ManagedInviteJoinAcceptance extends ManagedInviteJoinResolution {
  readonly requestMessage: RawMessageEvent;
}

/** Failed join processing plus the raw request message that failed. */
export interface ManagedInviteJoinFailure {
  readonly error: SignetError;
  readonly requestMessage: RawMessageEvent;
}

interface InviteCandidateProcessResult {
  readonly accepted: boolean;
  readonly shouldRetry: boolean;
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
  /** Onboarding scheme used to detect and process invite joins. */
  readonly onboardingScheme?: OnboardingScheme;
  /** Best-effort callback after a join request is accepted. */
  readonly onJoinAccepted?: (
    acceptance: ManagedInviteJoinAcceptance,
  ) => Promise<void>;
  /** Best-effort callback after a structured join request fails. */
  readonly onJoinRejected?: (
    failure: ManagedInviteJoinFailure,
  ) => Promise<void>;
  /**
   * Milliseconds to retain logical invite dedupe keys after a successful join.
   * This only needs to cover the structured/fallback catch-up window.
   */
  readonly processedInviteKeyTtlMs?: number;
}

const RECENT_JOIN_SCAN_OPTIONS = {
  limit: 10,
  direction: "descending",
} satisfies ListMessagesOptions;
const DM_RECOVERY_RETRY_DELAY_MS = 250;
const MAX_DM_RECOVERY_RETRIES = 3;
const DEFAULT_PROCESSED_INVITE_KEY_TTL_MS = 5_000;
const DEFAULT_ONBOARDING_SCHEME = createConvosOnboardingScheme();

interface InviteRecoveryScanResult {
  readonly messages: readonly RawMessageEvent[];
  readonly shouldRetry: boolean;
}

function resolveInviteRequestKey(event: RawMessageEvent): string | null {
  const inviteSlug =
    extractJoinRequestContent(event.content)?.inviteSlug ??
    (typeof event.content === "string" ? event.content.trim() : undefined);

  if (!inviteSlug || inviteSlug.length === 0) {
    return null;
  }

  return `${event.senderInboxId.toLowerCase()}:${inviteSlug}`;
}

function preferInviteCandidate(
  current: RawMessageEvent | undefined,
  candidate: RawMessageEvent,
  onboardingScheme: OnboardingScheme,
): RawMessageEvent {
  if (!current) return candidate;

  const currentStructured = onboardingScheme.isJoinRequestContentType(
    current.contentType,
  );
  const candidateStructured = onboardingScheme.isJoinRequestContentType(
    candidate.contentType,
  );

  if (candidateStructured && !currentStructured) {
    return candidate;
  }

  return current;
}

function isInviteCandidate(
  event: CoreRawEvent,
  onboardingScheme: OnboardingScheme,
): event is RawMessageEvent {
  if (event.type !== "raw.message") return false;
  if (event.isHistorical) return false;
  if (onboardingScheme.isJoinRequestContentType(event.contentType)) {
    return true;
  }
  if (typeof event.content !== "string") return false;

  const text = event.content.trim();
  return text.length >= 50 && !text.includes(" ");
}

function normalizePrivateKeyHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function isRetryableInviteError(error: SignetError): boolean {
  return (
    error.category !== "validation" &&
    error.category !== "permission" &&
    error.category !== "auth"
  );
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
): Promise<ManagedInviteJoinDispatchOutcome> {
  const onboardingScheme = deps.onboardingScheme ?? DEFAULT_ONBOARDING_SCHEME;

  if (!isInviteCandidate(event, onboardingScheme)) {
    return { result: null, shouldRetry: false };
  }

  const identities = await deps.listIdentities();
  let lastError: SignetError | null = null;
  let shouldRetry = false;

  for (const identity of identities) {
    if (!identity.inboxId) {
      shouldRetry = true;
      continue;
    }

    const managed = deps.getManagedClient(identity.id);
    if (!managed) {
      shouldRetry = true;
      continue;
    }

    const keyResult = await deps.getWalletPrivateKeyHex(identity.id);
    if (Result.isError(keyResult)) {
      shouldRetry = true;
      continue;
    }

    const result = await onboardingScheme.processJoinRequest(
      {
        walletPrivateKeyHex: normalizePrivateKeyHex(keyResult.value),
        creatorInboxId: identity.inboxId,
        addMembersToGroup: (groupId, inboxIds) =>
          managed.addMembers(groupId, inboxIds),
        getGroupInviteTag: deps.getGroupInviteTag,
      },
      {
        senderInboxId: event.senderInboxId,
        content: event.content,
      },
    );
    if (Result.isOk(result)) {
      return {
        result: Result.ok({
          join: {
            groupId: result.value.groupId,
            requesterInboxId: result.value.requesterInboxId,
            inviteTag: result.value.inviteTag,
          },
          hostIdentityId: identity.id,
          hostInboxId: identity.inboxId,
        }),
        shouldRetry: false,
      };
    }
    lastError = result.error;
    if (isRetryableInviteError(result.error)) {
      shouldRetry = true;
    }
  }

  return { result: lastError ? Result.err(lastError) : null, shouldRetry };
}

async function listRecentInviteCandidatesAcrossManagedIdentities(
  deps: ManagedInviteHostListenerDeps,
  conversationId: string,
  processedMessageIds: ReadonlySet<string>,
  processedInviteKeys: ReadonlySet<string>,
): Promise<InviteRecoveryScanResult> {
  const onboardingScheme = deps.onboardingScheme ?? DEFAULT_ONBOARDING_SCHEME;
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
        if (!isInviteCandidate(event, onboardingScheme)) continue;
        if (processedMessageIds.has(event.messageId)) continue;
        const requestKey = resolveInviteRequestKey(event);
        if (requestKey && processedInviteKeys.has(requestKey)) continue;
        messages.set(
          requestKey ?? event.messageId,
          preferInviteCandidate(
            messages.get(requestKey ?? event.messageId),
            event,
            onboardingScheme,
          ),
        );
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
  processedInviteKeys: Set<string>,
  inflightMessageIds: Set<string>,
  inflightInviteKeys: Set<string>,
  markInviteKeyProcessed: (requestKey: string) => void,
): Promise<InviteCandidateProcessResult> {
  const requestKey = resolveInviteRequestKey(event);
  if (processedMessageIds.has(event.messageId)) {
    return { accepted: true, shouldRetry: false };
  }
  if (requestKey && processedInviteKeys.has(requestKey)) {
    return { accepted: true, shouldRetry: false };
  }
  if (inflightMessageIds.has(event.messageId)) {
    return { accepted: true, shouldRetry: false };
  }
  if (requestKey && inflightInviteKeys.has(requestKey)) {
    return { accepted: true, shouldRetry: false };
  }

  inflightMessageIds.add(event.messageId);
  if (requestKey) {
    inflightInviteKeys.add(requestKey);
  }

  try {
    const dispatchOutcome =
      await dispatchInviteJoinRequestAcrossManagedIdentities(deps, event);
    if (dispatchOutcome.result === null) {
      return { accepted: false, shouldRetry: dispatchOutcome.shouldRetry };
    }

    if (Result.isOk(dispatchOutcome.result)) {
      processedMessageIds.add(event.messageId);
      if (requestKey) {
        markInviteKeyProcessed(requestKey);
      }
      try {
        await deps.onJoinAccepted?.({
          ...dispatchOutcome.result.value,
          requestMessage: event,
        });
      } catch {
        // Acceptance already succeeded; keep the invite marked processed.
      }
      return { accepted: true, shouldRetry: false };
    }

    if (!dispatchOutcome.shouldRetry) {
      try {
        await deps.onJoinRejected?.({
          error: dispatchOutcome.result.error,
          requestMessage: event,
        });
      } catch {
        // Ignore audit/telemetry failures and preserve retry behavior below.
      }
    }

    return {
      accepted: false,
      shouldRetry: dispatchOutcome.shouldRetry,
    };
  } finally {
    inflightMessageIds.delete(event.messageId);
    if (requestKey) {
      inflightInviteKeys.delete(requestKey);
    }
  }
}

/**
 * Subscribe to raw core events and process invite join requests by trying
 * each managed identity with a registered inbox ID until one validates.
 */
export function startManagedInviteHostListener(
  deps: ManagedInviteHostListenerDeps,
): () => void {
  const onboardingScheme = deps.onboardingScheme ?? DEFAULT_ONBOARDING_SCHEME;
  const processedMessageIds = new Set<string>();
  const processedInviteKeys = new Set<string>();
  const inflightMessageIds = new Set<string>();
  const inflightInviteKeys = new Set<string>();
  const recoveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const processedInviteKeyTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  const processedInviteKeyTtlMs =
    deps.processedInviteKeyTtlMs ?? DEFAULT_PROCESSED_INVITE_KEY_TTL_MS;

  function clearRecoveryRetryTimer(dmId: string): void {
    const timer = recoveryRetryTimers.get(dmId);
    if (timer === undefined) return;
    clearTimeout(timer);
    recoveryRetryTimers.delete(dmId);
  }

  function clearProcessedInviteKeyTimer(requestKey: string): void {
    const timer = processedInviteKeyTimers.get(requestKey);
    if (timer === undefined) return;
    clearTimeout(timer);
    processedInviteKeyTimers.delete(requestKey);
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

  function markInviteKeyProcessed(requestKey: string): void {
    processedInviteKeys.add(requestKey);
    clearProcessedInviteKeyTimer(requestKey);
    const timer = setTimeout(() => {
      processedInviteKeys.delete(requestKey);
      processedInviteKeyTimers.delete(requestKey);
    }, processedInviteKeyTtlMs);
    unrefTimer(timer);
    processedInviteKeyTimers.set(requestKey, timer);
  }

  async function recoverInviteCandidatesFromDm(
    dmId: string,
    retryCount = 0,
  ): Promise<void> {
    const scanResult = await listRecentInviteCandidatesAcrossManagedIdentities(
      deps,
      dmId,
      processedMessageIds,
      processedInviteKeys,
    );
    let shouldRetry = scanResult.shouldRetry;

    for (const message of scanResult.messages) {
      const outcome = await processInviteCandidate(
        deps,
        message,
        processedMessageIds,
        processedInviteKeys,
        inflightMessageIds,
        inflightInviteKeys,
        markInviteKeyProcessed,
      );
      if (!outcome.accepted && outcome.shouldRetry) {
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
        if (!isInviteCandidate(event, onboardingScheme)) return;
        await processInviteCandidate(
          deps,
          event,
          processedMessageIds,
          processedInviteKeys,
          inflightMessageIds,
          inflightInviteKeys,
          markInviteKeyProcessed,
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
    for (const requestKey of processedInviteKeyTimers.keys()) {
      clearProcessedInviteKeyTimer(requestKey);
    }
    unsubscribe();
  };
}
