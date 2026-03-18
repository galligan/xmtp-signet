import { z } from "zod";
import { ViewConfig } from "./view.js";
import { GrantConfig } from "./grant.js";

/** Configuration used to issue a new session. */
export type SessionConfig = {
  agentInboxId: string;
  view: ViewConfig;
  grant: GrantConfig;
  ttlSeconds?: number | undefined;
  heartbeatInterval?: number | undefined;
};

/** Zod schema for session issuance input. */
export const SessionConfig: z.ZodType<SessionConfig> = z
  .object({
    agentInboxId: z.string().describe("Agent this session is for"),
    view: ViewConfig.describe("View configuration for this session"),
    grant: GrantConfig.describe("Grant configuration for this session"),
    ttlSeconds: z
      .number()
      .int()
      .positive()
      .default(3600)
      .describe("Session time-to-live in seconds"),
    heartbeatInterval: z
      .number()
      .int()
      .positive()
      .default(30)
      .describe("Expected heartbeat cadence in seconds"),
  })
  .describe("Configuration for issuing a new session");

/** Opaque session token returned to the harness. */
export type SessionToken = {
  sessionId: string;
  agentInboxId: string;
  sessionKeyFingerprint: string;
  issuedAt: string;
  expiresAt: string;
};

/** Zod schema for the opaque session token returned to the harness. */
export const SessionToken: z.ZodType<SessionToken> = z
  .object({
    sessionId: z.string().describe("Unique session identifier"),
    agentInboxId: z.string().describe("Agent this session belongs to"),
    sessionKeyFingerprint: z
      .string()
      .describe("Fingerprint of the session key"),
    issuedAt: z.string().datetime().describe("When the session was issued"),
    expiresAt: z.string().datetime().describe("When the session expires"),
  })
  .describe("Opaque session token issued to the harness");

/** Session credentials plus the encoded token string. */
export type IssuedSession = {
  token: string;
  session: SessionToken;
};

/** Zod schema for session credentials returned by issuance. */
export const IssuedSession: z.ZodType<IssuedSession> = z
  .object({
    token: z.string().min(1).describe("Session bearer token"),
    session: SessionToken.describe("Session metadata"),
  })
  .describe("Issued session credentials returned by session.issue");

/** Lifecycle state for an issued session. */
export const SessionState: z.ZodEnum<
  ["active", "expired", "revoked", "reauthorization-required"]
> = z
  .enum(["active", "expired", "revoked", "reauthorization-required"])
  .describe("Current lifecycle state of a session");

/** Lifecycle state for an issued session. */
export type SessionState = z.infer<typeof SessionState>;
