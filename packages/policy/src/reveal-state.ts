import type {
  ContentTypeId,
  RevealAccess,
  RevealRequest,
} from "@xmtp/signet-schemas";

/** Internal entry pairing reveal access with its request context. */
interface RevealEntry {
  readonly access: RevealAccess;
  readonly request: RevealRequest;
}

/** Serializable reveal entry that preserves request context for restore. */
export interface RevealStateEntry {
  readonly access: RevealAccess;
  readonly request: RevealRequest;
}

/** Snapshot format for the reveal state store. */
export interface RevealStateSnapshot {
  readonly activeReveals: readonly RevealStateEntry[];
}

/**
 * In-memory reveal state store scoped to a credential.
 * Persisted by the credential manager; the policy engine owns the logic.
 */
export interface RevealStateStore {
  /** Record active reveal access with its originating request. */
  record(reveal: RevealAccess, request: RevealRequest): void;

  /** Check if a specific message is revealed by any active access record. */
  isRevealed(
    messageId: string,
    groupId: string,
    threadId: string | null,
    senderInboxId: string,
    contentType: ContentTypeId,
    sentAt: string,
  ): boolean;

  /** Remove expired reveals. Returns count of removed records. */
  expireStale(now: Date): number;

  /** Snapshot the current state for serialization. */
  snapshot(): RevealStateSnapshot;

  /** Restore from a serialized snapshot. */
  restore(state: RevealStateSnapshot): void;
}

/**
 * Creates a new in-memory reveal state store.
 */
export function createRevealStateStore(): RevealStateStore {
  const entries: RevealEntry[] = [];

  return {
    record(reveal: RevealAccess, request: RevealRequest): void {
      entries.push({ access: reveal, request });
    },

    isRevealed(
      messageId: string,
      groupId: string,
      threadId: string | null,
      senderInboxId: string,
      contentType: ContentTypeId,
      sentAt: string,
    ): boolean {
      const now = Date.now();

      return entries.some((entry) => {
        // Skip expired reveal access
        if (
          entry.access.expiresAt !== null &&
          new Date(entry.access.expiresAt).getTime() <= now
        ) {
          return false;
        }

        // Must match the group
        if (entry.request.groupId !== groupId) {
          return false;
        }

        switch (entry.request.scope) {
          case "message":
            return entry.request.targetId === messageId;
          case "thread":
            return entry.request.targetId === threadId;
          case "sender":
            return entry.request.targetId === senderInboxId;
          case "content-type":
            return entry.request.targetId === contentType;
          case "time-window": {
            // targetId is "startISO|endISO" — check if sentAt falls within
            const pipeIdx = entry.request.targetId.indexOf("|");
            if (pipeIdx < 0) return false;
            const windowStart = new Date(
              entry.request.targetId.slice(0, pipeIdx),
            ).getTime();
            const windowEnd = new Date(
              entry.request.targetId.slice(pipeIdx + 1),
            ).getTime();
            if (isNaN(windowStart) || isNaN(windowEnd)) return false;
            const sentAtMs = new Date(sentAt).getTime();
            return sentAtMs >= windowStart && sentAtMs <= windowEnd;
          }
        }
      });
    },

    expireStale(now: Date): number {
      let removed = 0;
      const nowMs = now.getTime();

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry === undefined) continue;
        if (
          entry.access.expiresAt !== null &&
          new Date(entry.access.expiresAt).getTime() <= nowMs
        ) {
          entries.splice(i, 1);
          removed++;
        }
      }

      return removed;
    },

    snapshot(): RevealStateSnapshot {
      return {
        activeReveals: entries.map((e) => ({
          access: e.access,
          request: e.request,
        })),
      };
    },

    restore(state: RevealStateSnapshot): void {
      entries.length = 0;
      for (const entry of state.activeReveals) {
        entries.push({
          access: entry.access,
          request: entry.request,
        });
      }
    },
  };
}
