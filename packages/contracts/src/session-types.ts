import type {
  GrantConfig,
  SessionState,
  ViewConfig,
} from "@xmtp/signet-schemas";
import type { PolicyDelta } from "./policy-types.js";

/** Internal session state (superset of SessionToken). */
export interface SessionRecord {
  readonly sessionId: string;
  readonly agentInboxId: string;
  readonly sessionKeyFingerprint: string;
  readonly view: ViewConfig;
  readonly grant: GrantConfig;
  readonly state: SessionState;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastHeartbeat: string;
}

/** Result of checking whether a policy change is material. */
export interface MaterialityCheck {
  readonly isMaterial: boolean;
  readonly reason: string | null;
  readonly delta: PolicyDelta | null;
}
