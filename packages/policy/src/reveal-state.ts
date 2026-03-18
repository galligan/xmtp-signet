import type {
  ContentTypeId,
  RevealGrant,
  RevealRequest,
} from "@xmtp/signet-schemas";

/** Internal entry pairing a grant with its request context for matching. */
interface RevealEntry {
  readonly grant: RevealGrant;
  readonly request: RevealRequest;
}

/** Serializable reveal entry that preserves request context for restore. */
export interface RevealStateEntry {
  readonly grant: RevealGrant;
  readonly request: RevealRequest;
}

/** Snapshot format for the reveal state store. */
export interface RevealStateSnapshot {
  readonly activeReveals: readonly RevealStateEntry[];
}

/**
 * In-memory reveal state store scoped to an agent session.
 * Persisted by the session manager; the policy engine owns the logic.
 */
export interface RevealStateStore {
  /** Add a reveal grant with its originating request. */
  grant(reveal: RevealGrant, request: RevealRequest): void;

  /** Check if a specific message is revealed by any active grant. */
  isRevealed(
    messageId: string,
    groupId: string,
    threadId: string | null,
    senderInboxId: string,
    contentType: ContentTypeId,
    sentAt: string,
  ): boolean;

  /** Remove expired reveals. Returns count of removed grants. */
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
    grant(reveal: RevealGrant, request: RevealRequest): void {
      entries.push({ grant: reveal, request });
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
        // Skip expired grants
        if (
          entry.grant.expiresAt !== null &&
          new Date(entry.grant.expiresAt).getTime() <= now
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
          entry.grant.expiresAt !== null &&
          new Date(entry.grant.expiresAt).getTime() <= nowMs
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
          grant: e.grant,
          request: e.request,
        })),
      };
    },

    restore(state: RevealStateSnapshot): void {
      entries.length = 0;
      for (const entry of state.activeReveals) {
        entries.push({
          grant: entry.grant,
          request: entry.request,
        });
      }
    },
  };
}
