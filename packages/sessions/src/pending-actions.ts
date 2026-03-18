/**
 * In-memory store for pending actions awaiting owner confirmation.
 *
 * Actions are queued when a draft-only session attempts a side-effecting
 * operation. The owner confirms or denies via `confirm_action` requests.
 */

/** A queued action awaiting explicit owner approval. */
export interface PendingAction {
  readonly actionId: string;
  readonly sessionId: string;
  readonly actionType: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Store interface for pending actions. */
export interface PendingActionStore {
  /** Add a pending action to the store. */
  add(action: PendingAction): void;

  /** Look up a pending action by ID. Returns null if not found. */
  get(actionId: string): PendingAction | null;

  /** Confirm an action: removes and returns it, or null if not found. */
  confirm(actionId: string): PendingAction | null;

  /** Deny an action: removes and returns it, or null if not found. */
  deny(actionId: string): PendingAction | null;

  /** Remove all expired actions. Returns the number removed. */
  expireStale(now: Date): number;

  /** List all pending actions for a given session. */
  listBySession(sessionId: string): readonly PendingAction[];
}

/** Create an in-memory store for pending actions. */
export function createPendingActionStore(): PendingActionStore {
  const actions = new Map<string, PendingAction>();

  function removeAndReturn(actionId: string): PendingAction | null {
    const action = actions.get(actionId);
    if (action === undefined) return null;
    actions.delete(actionId);
    return action;
  }

  return {
    add(action: PendingAction): void {
      actions.set(action.actionId, action);
    },

    get(actionId: string): PendingAction | null {
      return actions.get(actionId) ?? null;
    },

    confirm(actionId: string): PendingAction | null {
      return removeAndReturn(actionId);
    },

    deny(actionId: string): PendingAction | null {
      return removeAndReturn(actionId);
    },

    expireStale(now: Date): number {
      const nowMs = now.getTime();
      let removed = 0;
      for (const [id, action] of actions) {
        if (new Date(action.expiresAt).getTime() <= nowMs) {
          actions.delete(id);
          removed++;
        }
      }
      return removed;
    },

    listBySession(sessionId: string): readonly PendingAction[] {
      const result: PendingAction[] = [];
      for (const action of actions.values()) {
        if (action.sessionId === sessionId) {
          result.push(action);
        }
      }
      return result;
    },
  };
}
