# 02-schemas

**Package:** `@xmtp-broker/schemas`
**Spec version:** 0.1.0

## Overview

The schemas package is the foundation of the entire broker system. It defines every Zod schema, inferred TypeScript type, and error class used across all other packages. No runtime logic lives here -- only shapes, validation, and error taxonomy.

Cross-package interfaces (service contracts, provider interfaces, event types) live in `@xmtp-broker/contracts`, not here. The split principle: **schemas** = "what shape is the data?" while **contracts** = "what can components do to each other?" See [02b-contracts](02b-contracts.md) for the contracts package spec.

Every other package in the broker monorepo imports from `@xmtp-broker/schemas`. Nothing imports into it except `@xmtp-broker/contracts`. This zero-dependency position means changes here cascade everywhere, so the schemas must be stable, well-described, and complete from day one.

All schemas carry `.describe()` annotations so they can be converted to JSON Schema for MCP tool definitions, documentation generation, and cross-language harness consumption. All TypeScript types are derived via `z.infer<>` -- no manual interfaces, no type duplication.

Fields that are conceptually optional use `.nullable()` with an explicit `null` value, never `.optional()`. This ensures every attestation, event, and request has a predictable shape regardless of which fields are populated.

## Dependencies

**Imports:** `zod` (sole runtime dependency)

**Imported by:** `@xmtp-broker/contracts` (directly), and transitively by every other `@xmtp-broker/*` package

## Public Interfaces

The package exports schemas, inferred types, error classes, and utility constants. All exports are named -- no default exports.

### Content Type Identifiers

```typescript
/**
 * XMTP content type identifier following the authority/type:version convention.
 * Examples: "xmtp.org/text:1.0", "xmtp.org/reaction:1.0"
 */
const ContentTypeId = z
  .string()
  .regex(/^[a-z0-9.-]+\/[a-zA-Z0-9]+:\d+\.\d+$/)
  .describe("XMTP content type identifier (authority/type:version)");

type ContentTypeId = z.infer<typeof ContentTypeId>;
```

### Baseline Content Types

```typescript
/** Standard XMTP content types accepted by default. */
const BASELINE_CONTENT_TYPES = [
  "xmtp.org/text:1.0",
  "xmtp.org/reaction:1.0",
  "xmtp.org/reply:1.0",
  "xmtp.org/readReceipt:1.0",
  "xmtp.org/groupUpdated:1.0",
] as const satisfies readonly ContentTypeId[];

type BaselineContentType = (typeof BASELINE_CONTENT_TYPES)[number];
```

### Content Type Payload Schemas

Each baseline content type has a corresponding payload schema for validation at the broker boundary.

```typescript
const TextPayload = z.object({
  text: z.string().min(1).describe("Message text content"),
}).describe("Text message payload");

const ReactionPayload = z.object({
  reference: z.string().describe("Message ID being reacted to"),
  action: z.enum(["added", "removed"]).describe("Whether reaction is added or removed"),
  content: z.string().describe("Reaction content (emoji or text)"),
  schema: z.enum(["unicode", "shortcode", "custom"]).describe("Reaction schema type"),
}).describe("Reaction payload");

const ReplyPayload = z.object({
  reference: z.string().describe("Message ID being replied to"),
  content: z.object({
    type: ContentTypeId.describe("Content type of the reply body"),
    payload: z.unknown().describe("Encoded reply content"),
  }).describe("Reply body"),
}).describe("Reply payload");

const ReadReceiptPayload = z.object({}).describe("Read receipt payload (empty body)");

const GroupUpdatedPayload = z.object({
  initiatedByInboxId: z.string().describe("Inbox ID of the member who initiated the update"),
  addedInboxes: z.array(z.string()).describe("Inbox IDs added to the group"),
  removedInboxes: z.array(z.string()).describe("Inbox IDs removed from the group"),
  metadataFieldsChanged: z.array(z.object({
    fieldName: z.string().describe("Name of the changed metadata field"),
    oldValue: z.string().nullable().describe("Previous value"),
    newValue: z.string().nullable().describe("New value"),
  })).describe("Metadata fields that changed"),
}).describe("Group membership/metadata update payload");
```

Content type registry for extensibility:

```typescript
/** Map from content type ID to its payload schema. Extensible at runtime. */
const CONTENT_TYPE_SCHEMAS: Record<string, z.ZodType> = {
  "xmtp.org/text:1.0": TextPayload,
  "xmtp.org/reaction:1.0": ReactionPayload,
  "xmtp.org/reply:1.0": ReplyPayload,
  "xmtp.org/readReceipt:1.0": ReadReceiptPayload,
  "xmtp.org/groupUpdated:1.0": GroupUpdatedPayload,
};
```

### View Schemas

```typescript
const ViewMode = z.enum([
  "full",
  "thread-only",
  "redacted",
  "reveal-only",
  "summary-only",
]).describe("Visibility mode for the agent's view of conversations");

type ViewMode = z.infer<typeof ViewMode>;

const ContentTypeAllowlist = z
  .array(ContentTypeId)
  .min(1)
  .describe("Content types the agent is allowed to see");

type ContentTypeAllowlist = z.infer<typeof ContentTypeAllowlist>;

const ThreadScope = z.object({
  groupId: z.string().describe("Group the thread belongs to"),
  threadId: z.string().nullable().describe("Specific thread ID, or null for entire group"),
}).describe("Scopes a view to a specific group and optional thread");

type ThreadScope = z.infer<typeof ThreadScope>;

const ViewConfig = z.object({
  mode: ViewMode.describe("Base visibility mode"),
  threadScopes: z.array(ThreadScope).min(1).describe("Groups and threads this view covers"),
  contentTypes: ContentTypeAllowlist.describe("Allowed content types for this view"),
}).describe("Complete view configuration for an agent session");

type ViewConfig = z.infer<typeof ViewConfig>;
```

### Grant Schemas

```typescript
const MessagingGrant = z.object({
  send: z.boolean().describe("Can send messages"),
  reply: z.boolean().describe("Can reply in threads"),
  react: z.boolean().describe("Can add/remove reactions"),
  draftOnly: z.boolean().describe("Messages require owner confirmation before sending"),
}).describe("Messaging action permissions");

type MessagingGrant = z.infer<typeof MessagingGrant>;

const GroupManagementGrant = z.object({
  addMembers: z.boolean().describe("Can add members to the group"),
  removeMembers: z.boolean().describe("Can remove members from the group"),
  updateMetadata: z.boolean().describe("Can update group metadata"),
  inviteUsers: z.boolean().describe("Can issue invitations"),
}).describe("Group management permissions");

type GroupManagementGrant = z.infer<typeof GroupManagementGrant>;

const ToolScope = z.object({
  toolId: z.string().describe("Identifier for the tool"),
  allowed: z.boolean().describe("Whether this tool is currently allowed"),
  parameters: z.record(z.string(), z.unknown()).nullable()
    .describe("Permitted parameter constraints, null for unconstrained"),
}).describe("Permission scope for a single tool");

type ToolScope = z.infer<typeof ToolScope>;

const ToolGrant = z.object({
  scopes: z.array(ToolScope).describe("Per-tool permission scopes"),
}).describe("Tool capability permissions");

type ToolGrant = z.infer<typeof ToolGrant>;

const EgressGrant = z.object({
  storeExcerpts: z.boolean().describe("Can store message excerpts"),
  useForMemory: z.boolean().describe("Can use content for persistent memory"),
  forwardToProviders: z.boolean().describe("Can forward content to inference providers"),
  quoteRevealed: z.boolean().describe("Can quote revealed content in messages"),
  summarize: z.boolean().describe("Can summarize hidden or revealed content"),
}).describe("Retention and egress permissions");

type EgressGrant = z.infer<typeof EgressGrant>;

const GrantConfig = z.object({
  messaging: MessagingGrant.describe("Messaging action permissions"),
  groupManagement: GroupManagementGrant.describe("Group management permissions"),
  tools: ToolGrant.describe("Tool capability permissions"),
  egress: EgressGrant.describe("Retention and egress permissions"),
}).describe("Complete grant configuration for an agent session");

type GrantConfig = z.infer<typeof GrantConfig>;
```

### Attestation Schema

The full attestation schema. All fields are present; optional fields use `null`. This is the shape posted to the group as a structured content type.

```typescript
const InferenceMode = z.enum([
  "local",
  "external",
  "hybrid",
  "unknown",
]).describe("How the agent performs inference");

type InferenceMode = z.infer<typeof InferenceMode>;

const ContentEgressScope = z.enum([
  "full-messages",
  "summaries-only",
  "tool-calls-only",
  "none",
  "unknown",
]).describe("What content leaves the broker boundary");

type ContentEgressScope = z.infer<typeof ContentEgressScope>;

const RetentionAtProvider = z.enum([
  "none",
  "session",
  "persistent",
  "unknown",
]).describe("How long the inference provider retains content");

type RetentionAtProvider = z.infer<typeof RetentionAtProvider>;

const HostingMode = z.enum([
  "local",
  "self-hosted",
  "managed",
]).describe("Where the broker runs");

type HostingMode = z.infer<typeof HostingMode>;

const TrustTier = z.enum([
  "unverified",
  "source-verified",
  "reproducibly-verified",
  "runtime-attested",
]).describe("Highest trust tier the broker can demonstrate");

type TrustTier = z.infer<typeof TrustTier>;

const RevocationRules = z.object({
  maxTtlSeconds: z.number().int().positive()
    .describe("Maximum attestation lifetime in seconds"),
  requireHeartbeat: z.boolean()
    .describe("Whether missed heartbeats trigger auto-revocation"),
  ownerCanRevoke: z.boolean()
    .describe("Whether the owner can revoke at any time"),
  adminCanRemove: z.boolean()
    .describe("Whether group admins can remove the agent"),
}).describe("Rules governing how this attestation can be revoked");

type RevocationRules = z.infer<typeof RevocationRules>;

const AttestationSchema = z.object({
  attestationId: z.string().describe("Unique identifier for this attestation"),
  previousAttestationId: z.string().nullable()
    .describe("ID of the attestation this supersedes, null for initial"),
  agentInboxId: z.string().describe("XMTP inbox ID of the agent"),
  ownerInboxId: z.string().describe("XMTP inbox ID of the agent's owner"),
  groupId: z.string().describe("Group this attestation applies to"),
  threadScope: z.string().nullable()
    .describe("Thread scope if narrower than full group, null for group-wide"),
  viewMode: ViewMode.describe("Current view mode"),
  contentTypes: z.array(ContentTypeId)
    .describe("Content types the agent can see"),
  grantedOps: z.array(z.string())
    .describe("Granted operation identifiers"),
  toolScopes: z.array(z.string())
    .describe("Tool scope identifiers the agent may use"),
  inferenceMode: InferenceMode.describe("How the agent performs inference"),
  inferenceProviders: z.array(z.string())
    .describe("Envelope of inference providers the agent may use"),
  contentEgressScope: ContentEgressScope
    .describe("What content leaves the broker boundary"),
  retentionAtProvider: RetentionAtProvider
    .describe("Provider-side retention policy"),
  hostingMode: HostingMode.describe("Where the broker runs"),
  trustTier: TrustTier
    .describe("Highest demonstrated trust tier"),
  buildProvenanceRef: z.string().nullable()
    .describe("Reference to build provenance bundle, null if unavailable"),
  verifierStatementRef: z.string().nullable()
    .describe("Reference to verifier statement, null if unavailable"),
  sessionKeyFingerprint: z.string().nullable()
    .describe("Fingerprint of the current session key, null if not bound"),
  policyHash: z.string()
    .describe("Hash of the full policy config for integrity checking"),
  heartbeatInterval: z.number().int().positive().default(30)
    .describe("Expected heartbeat cadence in seconds"),
  issuedAt: z.string().datetime()
    .describe("ISO 8601 timestamp when this attestation was issued"),
  expiresAt: z.string().datetime()
    .describe("ISO 8601 timestamp when this attestation expires"),
  revocationRules: RevocationRules
    .describe("Rules governing revocation of this attestation"),
  issuer: z.string()
    .describe("Identity of the attestation issuer (broker's signing identity)"),
}).describe("Group-visible capability attestation for an agent");

type Attestation = z.infer<typeof AttestationSchema>;
```

### Session Schemas

```typescript
const SessionConfig = z.object({
  agentInboxId: z.string().describe("Agent this session is for"),
  view: ViewConfig.describe("View configuration for this session"),
  grant: GrantConfig.describe("Grant configuration for this session"),
  ttlSeconds: z.number().int().positive().default(3600)
    .describe("Session time-to-live in seconds"),
  heartbeatInterval: z.number().int().positive().default(30)
    .describe("Expected heartbeat cadence in seconds"),
}).describe("Configuration for issuing a new session");

type SessionConfig = z.infer<typeof SessionConfig>;

const SessionToken = z.object({
  sessionId: z.string().describe("Unique session identifier"),
  agentInboxId: z.string().describe("Agent this session belongs to"),
  sessionKeyFingerprint: z.string()
    .describe("Fingerprint of the session key"),
  issuedAt: z.string().datetime().describe("When the session was issued"),
  expiresAt: z.string().datetime().describe("When the session expires"),
}).describe("Opaque session token issued to the harness");

type SessionToken = z.infer<typeof SessionToken>;

const SessionState = z.enum([
  "active",
  "expired",
  "revoked",
  "reauthorization-required",
]).describe("Current lifecycle state of a session");

type SessionState = z.infer<typeof SessionState>;
```

### Reveal Schemas

```typescript
const RevealScope = z.enum([
  "message",
  "thread",
  "time-window",
  "content-type",
  "sender",
]).describe("Granularity of a reveal operation");

type RevealScope = z.infer<typeof RevealScope>;

const RevealRequest = z.object({
  revealId: z.string().describe("Unique reveal request identifier"),
  groupId: z.string().describe("Group containing the content"),
  scope: RevealScope.describe("What granularity to reveal"),
  targetId: z.string().describe("ID of the message, thread, content type, or sender"),
  requestedBy: z.string().describe("Inbox ID of the member requesting the reveal"),
  expiresAt: z.string().datetime().nullable()
    .describe("When this reveal expires, null for permanent"),
}).describe("Request to reveal content to an agent");

type RevealRequest = z.infer<typeof RevealRequest>;

const RevealGrant = z.object({
  revealId: z.string().describe("Matches the RevealRequest.revealId"),
  grantedAt: z.string().datetime().describe("When the reveal was granted"),
  grantedBy: z.string().describe("Inbox ID of the granting member"),
  expiresAt: z.string().datetime().nullable()
    .describe("When this grant expires, null for permanent"),
}).describe("Granted reveal making content visible to the agent");

type RevealGrant = z.infer<typeof RevealGrant>;

const RevealState = z.object({
  activeReveals: z.array(RevealGrant)
    .describe("Currently active reveal grants"),
}).describe("Aggregate reveal state for a session");

type RevealState = z.infer<typeof RevealState>;
```

### Revocation Schemas

```typescript
const AgentRevocationReason = z.enum([
  "owner-initiated",
  "session-expired",
  "admin-removed",
  "heartbeat-timeout",
  "policy-violation",
]).describe("Why the agent was revoked from a group");

type AgentRevocationReason = z.infer<typeof AgentRevocationReason>;

const SessionRevocationReason = z.enum([
  "owner-initiated",
  "session-expired",
  "heartbeat-timeout",
  "policy-violation",
  "reauthorization-required",
]).describe("Why a session was revoked");

type SessionRevocationReason = z.infer<typeof SessionRevocationReason>;

const RevocationAttestation = z.object({
  attestationId: z.string().describe("ID of this revocation attestation"),
  previousAttestationId: z.string()
    .describe("ID of the attestation being revoked"),
  agentInboxId: z.string().describe("Agent being revoked"),
  groupId: z.string().describe("Group the revocation applies to"),
  reason: AgentRevocationReason.describe("Why the agent was revoked"),
  revokedAt: z.string().datetime().describe("When the revocation took effect"),
  issuer: z.string().describe("Identity of the revocation issuer"),
}).describe("Group-visible revocation of an agent's attestation");

type RevocationAttestation = z.infer<typeof RevocationAttestation>;
```

### Event Schemas (broker to harness)

Events use a discriminated union on the `type` field. Each event carries enough context for the harness to act without additional lookups.

```typescript
const MessageVisibility = z.enum([
  "visible",
  "historical",
  "hidden",
  "revealed",
  "redacted",
]).describe("How the message is being projected to the agent");

type MessageVisibility = z.infer<typeof MessageVisibility>;

const MessageEvent = z.object({
  type: z.literal("message.visible").describe("Event type discriminator"),
  messageId: z.string().describe("XMTP message ID"),
  groupId: z.string().describe("Group the message belongs to"),
  senderInboxId: z.string().describe("Inbox ID of the sender"),
  contentType: ContentTypeId.describe("Content type of the message"),
  content: z.unknown().describe("Decoded message payload"),
  visibility: MessageVisibility.describe("How this message is projected"),
  sentAt: z.string().datetime().describe("When the message was sent"),
  attestationId: z.string().nullable()
    .describe("Attestation ID if sent by a brokered agent, null otherwise"),
}).describe("A message projected to the agent according to its view");

const AttestationEvent = z.object({
  type: z.literal("attestation.updated").describe("Event type discriminator"),
  attestation: AttestationSchema.describe("The updated attestation"),
}).describe("Attestation was published or updated");

const SessionStartedEvent = z.object({
  type: z.literal("session.started").describe("Event type discriminator"),
  session: SessionToken.describe("The issued session token"),
  view: ViewConfig.describe("Active view for this session"),
  grant: GrantConfig.describe("Active grant for this session"),
}).describe("Session successfully established");

const SessionExpiredEvent = z.object({
  type: z.literal("session.expired").describe("Event type discriminator"),
  sessionId: z.string().describe("Expired session ID"),
  reason: z.string().describe("Why the session expired"),
}).describe("Session has expired");

const SessionReauthRequiredEvent = z.object({
  type: z.literal("session.reauthorization_required")
    .describe("Event type discriminator"),
  sessionId: z.string().describe("Session requiring reauthorization"),
  reason: z.string().describe("What policy change triggered reauthorization"),
}).describe("Session must be reauthorized due to material policy change");

const HeartbeatEvent = z.object({
  type: z.literal("heartbeat").describe("Event type discriminator"),
  sessionId: z.string().describe("Session this heartbeat is for"),
  timestamp: z.string().datetime().describe("Heartbeat timestamp"),
}).describe("Liveness signal from the broker");

const RevealEvent = z.object({
  type: z.literal("message.revealed").describe("Event type discriminator"),
  messageId: z.string().describe("Message being revealed"),
  groupId: z.string().describe("Group the message belongs to"),
  contentType: ContentTypeId.describe("Content type of the revealed message"),
  content: z.unknown().describe("Decoded message payload"),
  revealId: z.string().describe("Reveal grant that authorized this"),
}).describe("Previously hidden content revealed to the agent");

const ViewUpdatedEvent = z.object({
  type: z.literal("view.updated").describe("Event type discriminator"),
  view: ViewConfig.describe("Updated view configuration"),
}).describe("View configuration changed within the current session");

const GrantUpdatedEvent = z.object({
  type: z.literal("grant.updated").describe("Event type discriminator"),
  grant: GrantConfig.describe("Updated grant configuration"),
}).describe("Grant configuration changed within the current session");

const AgentRevokedEvent = z.object({
  type: z.literal("agent.revoked").describe("Event type discriminator"),
  revocation: RevocationAttestation.describe("The revocation details"),
}).describe("Agent has been revoked from the group");

const ActionConfirmationEvent = z.object({
  type: z.literal("action.confirmation_required")
    .describe("Event type discriminator"),
  actionId: z.string().describe("ID of the pending action"),
  actionType: z.string().describe("Type of action awaiting confirmation"),
  preview: z.unknown().describe("Preview of the action for owner review"),
}).describe("An action requires owner confirmation before execution");

const BrokerRecoveryEvent = z.object({
  type: z.literal("broker.recovery.complete")
    .describe("Event type discriminator"),
  caughtUpThrough: z.string().datetime()
    .describe("Timestamp through which the broker has resynced"),
}).describe("Broker has recovered and resynced");

/** Discriminated union of all broker-to-harness events. */
const BrokerEvent = z.discriminatedUnion("type", [
  MessageEvent,
  AttestationEvent,
  SessionStartedEvent,
  SessionExpiredEvent,
  SessionReauthRequiredEvent,
  HeartbeatEvent,
  RevealEvent,
  ViewUpdatedEvent,
  GrantUpdatedEvent,
  AgentRevokedEvent,
  ActionConfirmationEvent,
  BrokerRecoveryEvent,
]).describe("Any event the broker may send to a harness");

type BrokerEvent = z.infer<typeof BrokerEvent>;
```

### Request Schemas (harness to broker)

```typescript
const SendMessageRequest = z.object({
  type: z.literal("send_message").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID for correlation"),
  groupId: z.string().describe("Target group"),
  contentType: ContentTypeId.describe("Content type of the message"),
  content: z.unknown().describe("Encoded message payload"),
}).describe("Send a message to a group");

const SendReactionRequest = z.object({
  type: z.literal("send_reaction").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  groupId: z.string().describe("Target group"),
  messageId: z.string().describe("Message to react to"),
  action: z.enum(["added", "removed"]).describe("Add or remove reaction"),
  content: z.string().describe("Reaction content"),
}).describe("React to a message");

const SendReplyRequest = z.object({
  type: z.literal("send_reply").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  groupId: z.string().describe("Target group"),
  messageId: z.string().describe("Message to reply to"),
  contentType: ContentTypeId.describe("Content type of the reply body"),
  content: z.unknown().describe("Encoded reply payload"),
}).describe("Reply to a message in a thread");

const UpdateViewRequest = z.object({
  type: z.literal("update_view").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  view: ViewConfig.describe("Requested view update"),
}).describe("Request a view update (broker may reject if material escalation)");

const RevealContentRequest = z.object({
  type: z.literal("reveal_content").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  reveal: RevealRequest.describe("Reveal details"),
}).describe("Request content be revealed to the agent");

const ConfirmActionRequest = z.object({
  type: z.literal("confirm_action").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  actionId: z.string().describe("Action being confirmed or denied"),
  confirmed: z.boolean().describe("Whether the action is approved"),
}).describe("Confirm or deny a pending action");

const HeartbeatRequest = z.object({
  type: z.literal("heartbeat").describe("Request type discriminator"),
  requestId: z.string().describe("Client-generated request ID"),
  sessionId: z.string().describe("Session sending the heartbeat"),
}).describe("Heartbeat from the harness to keep the session alive");

/** Discriminated union of all harness-to-broker requests. */
const HarnessRequest = z.discriminatedUnion("type", [
  SendMessageRequest,
  SendReactionRequest,
  SendReplyRequest,
  UpdateViewRequest,
  RevealContentRequest,
  ConfirmActionRequest,
  HeartbeatRequest,
]).describe("Any request a harness may send to the broker");

type HarnessRequest = z.infer<typeof HarnessRequest>;
```

### Response Envelope

```typescript
const RequestSuccess = z.object({
  ok: z.literal(true).describe("Success indicator"),
  requestId: z.string().describe("Correlates with the original request"),
  data: z.unknown().describe("Response payload, type depends on request"),
}).describe("Successful response to a harness request");

const RequestFailure = z.object({
  ok: z.literal(false).describe("Failure indicator"),
  requestId: z.string().describe("Correlates with the original request"),
  error: z.object({
    code: z.number().int().describe("Numeric error code"),
    category: z.string().describe("Error category from taxonomy"),
    message: z.string().describe("Human-readable error description"),
    context: z.record(z.string(), z.unknown()).nullable()
      .describe("Structured error context for debugging"),
  }).describe("Error details"),
}).describe("Failed response to a harness request");

const RequestResponse = z.discriminatedUnion("ok", [
  RequestSuccess,
  RequestFailure,
]).describe("Response envelope for harness requests");

type RequestResponse = z.infer<typeof RequestResponse>;
```

## Error Taxonomy

### Error Categories

```typescript
const ErrorCategory = z.enum([
  "validation",
  "not_found",
  "permission",
  "auth",
  "internal",
  "timeout",
  "cancelled",
]).describe("Error category for cross-transport mapping");

type ErrorCategory = z.infer<typeof ErrorCategory>;
```

### Cross-Transport Mappings

| Category    | Exit Code | HTTP | JSON-RPC | Retryable |
|-------------|-----------|------|----------|-----------|
| validation  | 1         | 400  | -32602   | no        |
| not_found   | 2         | 404  | -32007   | no        |
| permission  | 4         | 403  | -32003   | no        |
| auth        | 9         | 401  | -32000   | no        |
| internal    | 8         | 500  | -32603   | no        |
| timeout     | 5         | 504  | -32001   | yes       |
| cancelled   | 130       | 499  | -32006   | no        |

```typescript
interface ErrorCategoryMeta {
  readonly exitCode: number;
  readonly statusCode: number;
  readonly jsonRpcCode: number;
  readonly retryable: boolean;
}

/** Lookup table for category metadata. */
const ERROR_CATEGORY_META: Record<ErrorCategory, ErrorCategoryMeta> = {
  validation:  { exitCode: 1,   statusCode: 400, jsonRpcCode: -32602, retryable: false },
  not_found:   { exitCode: 2,   statusCode: 404, jsonRpcCode: -32007, retryable: false },
  permission:  { exitCode: 4,   statusCode: 403, jsonRpcCode: -32003, retryable: false },
  auth:        { exitCode: 9,   statusCode: 401, jsonRpcCode: -32000, retryable: false },
  internal:    { exitCode: 8,   statusCode: 500, jsonRpcCode: -32603, retryable: false },
  timeout:     { exitCode: 5,   statusCode: 504, jsonRpcCode: -32001, retryable: true  },
  cancelled:   { exitCode: 130, statusCode: 499, jsonRpcCode: -32006, retryable: false },
};

function errorCategoryMeta(category: ErrorCategory): ErrorCategoryMeta {
  return ERROR_CATEGORY_META[category];
}
```

### TaggedError Base

```typescript
/**
 * Base interface for all broker errors. Discriminated by `_tag`.
 * Never constructed directly -- use the static factory on each subclass.
 */
interface BrokerError extends Error {
  readonly _tag: string;
  readonly code: number;
  readonly category: ErrorCategory;
  readonly context: Record<string, unknown> | null;
}
```

### Error Classes

Each class has a static `create()` factory, a numeric code, and maps to one category.

```typescript
// -- validation (code range 1000-1099) --

class ValidationError extends Error implements BrokerError {
  readonly _tag = "ValidationError";
  readonly code = 1000;
  readonly category = "validation" as const;
  constructor(
    message: string,
    readonly context: { field: string; reason: string } & Record<string, unknown>,
  ) { super(message); }

  static create(field: string, reason: string, extra?: Record<string, unknown>): ValidationError {
    return new ValidationError(
      `Validation failed on '${field}': ${reason}`,
      { field, reason, ...extra },
    );
  }
}

// -- not_found (1100-1199) --

class NotFoundError extends Error implements BrokerError {
  readonly _tag = "NotFoundError";
  readonly code = 1100;
  readonly category = "not_found" as const;
  constructor(
    message: string,
    readonly context: { resourceType: string; resourceId: string } & Record<string, unknown>,
  ) { super(message); }

  static create(resourceType: string, resourceId: string): NotFoundError {
    return new NotFoundError(
      `${resourceType} '${resourceId}' not found`,
      { resourceType, resourceId },
    );
  }
}

// -- permission (1200-1299) --

class PermissionError extends Error implements BrokerError {
  readonly _tag = "PermissionError";
  readonly code = 1200;
  readonly category = "permission" as const;
  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) { super(message); }

  static create(message: string, context?: Record<string, unknown>): PermissionError {
    return new PermissionError(message, context ?? null);
  }
}

class GrantDeniedError extends Error implements BrokerError {
  readonly _tag = "GrantDeniedError";
  readonly code = 1210;
  readonly category = "permission" as const;
  constructor(
    message: string,
    readonly context: { operation: string; grantType: string } & Record<string, unknown>,
  ) { super(message); }

  static create(operation: string, grantType: string): GrantDeniedError {
    return new GrantDeniedError(
      `Operation '${operation}' denied: missing ${grantType} grant`,
      { operation, grantType },
    );
  }
}

// -- auth (1300-1399) --

class AuthError extends Error implements BrokerError {
  readonly _tag = "AuthError";
  readonly code = 1300;
  readonly category = "auth" as const;
  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) { super(message); }

  static create(message: string, context?: Record<string, unknown>): AuthError {
    return new AuthError(message, context ?? null);
  }
}

class SessionExpiredError extends Error implements BrokerError {
  readonly _tag = "SessionExpiredError";
  readonly code = 1310;
  readonly category = "auth" as const;
  constructor(
    message: string,
    readonly context: { sessionId: string } & Record<string, unknown>,
  ) { super(message); }

  static create(sessionId: string): SessionExpiredError {
    return new SessionExpiredError(
      `Session '${sessionId}' has expired`,
      { sessionId },
    );
  }
}

// -- internal (1400-1499) --

class InternalError extends Error implements BrokerError {
  readonly _tag = "InternalError";
  readonly code = 1400;
  readonly category = "internal" as const;
  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) { super(message); }

  static create(message: string, context?: Record<string, unknown>): InternalError {
    return new InternalError(message, context ?? null);
  }
}

// -- timeout (1500-1599) --

class TimeoutError extends Error implements BrokerError {
  readonly _tag = "TimeoutError";
  readonly code = 1500;
  readonly category = "timeout" as const;
  constructor(
    message: string,
    readonly context: { operation: string; timeoutMs: number } & Record<string, unknown>,
  ) { super(message); }

  static create(operation: string, timeoutMs: number): TimeoutError {
    return new TimeoutError(
      `Operation '${operation}' timed out after ${timeoutMs}ms`,
      { operation, timeoutMs },
    );
  }
}

// -- cancelled (1600-1699) --

class CancelledError extends Error implements BrokerError {
  readonly _tag = "CancelledError";
  readonly code = 1600;
  readonly category = "cancelled" as const;
  constructor(
    message: string,
    readonly context: Record<string, unknown> | null,
  ) { super(message); }

  static create(message: string): CancelledError {
    return new CancelledError(message, null);
  }
}

// -- domain-specific --

class AttestationError extends Error implements BrokerError {
  readonly _tag = "AttestationError";
  readonly code = 1010;
  readonly category = "validation" as const;
  constructor(
    message: string,
    readonly context: { attestationId: string } & Record<string, unknown>,
  ) { super(message); }

  static create(attestationId: string, reason: string): AttestationError {
    return new AttestationError(
      `Attestation '${attestationId}': ${reason}`,
      { attestationId, reason },
    );
  }
}
```

### Discriminated Error Matching

```typescript
type AnyBrokerError =
  | ValidationError
  | NotFoundError
  | PermissionError
  | GrantDeniedError
  | AuthError
  | SessionExpiredError
  | InternalError
  | TimeoutError
  | CancelledError
  | AttestationError;

/** Type-safe error matching by _tag discriminant. */
function matchError<T>(
  error: AnyBrokerError,
  handlers: { [K in AnyBrokerError["_tag"]]: (e: Extract<AnyBrokerError, { _tag: K }>) => T },
): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (handlers as any)[error._tag](error);
}
```

## Behaviors

This package has no runtime behavior beyond validation. All schemas are pure declarations. Error classes are simple value objects with factory constructors.

### Schema Composition Rules

1. `ViewConfig` and `GrantConfig` are independently composable -- any view mode can pair with any grant configuration.
2. The effective content type allowlist for an agent is `intersection(broker.allowlist, agent.view.contentTypes)`. The schemas define the agent's requested list; the policy engine computes the effective list at runtime.
3. Attestation `grantedOps` is a string array derived from the `GrantConfig` at attestation time. The mapping from structured grants to string identifiers is defined in the attestation package, not here.

### Nullable vs Optional Convention

Every field is either required or `.nullable()`. No `.optional()` anywhere. This means:
- Serialized attestations always have every key.
- Harnesses can rely on a stable shape without defensive `in` checks.
- Schema evolution adds new nullable fields rather than making existing fields optional.

## Error Cases

This package defines errors but does not produce them at runtime. Error production happens in consumer packages. The key design constraints:

- Each error has exactly one `category` -- no multi-category errors.
- Only `timeout` is retryable. `cancelled` is terminal (the caller chose to stop).
- `GrantDeniedError` and `SessionExpiredError` are domain-specific subclasses that share categories with their parent (`permission` and `auth` respectively) but have distinct `_tag` values for precise matching.
- Error `context` is structured data, not stringified. Transports serialize it as-is.

## Open Questions Resolved

**Q: What is the exact minimum viable attestation schema?** (PRD Open Questions)
**A:** Full schema from day one with all 24 fields. Fields that may not be populated use `null`. Rationale: prevents schema drift, clients always know the shape, and the attestation format is a candidate XIP -- better to define it completely now than to add fields later and break consumers.

**Q: Should session issuance be tied to explicit per-thread scopes by default?** (PRD Open Questions)
**A:** No. Sessions scope to agent + groups via `ViewConfig.threadScopes`. Thread filtering is a view concern within a session, not a session-level binding. Rationale: simpler session model; thread scoping changes are non-material view updates that don't require session reauthorization.

**Q: What is the appropriate default heartbeat interval?** (PRD Open Questions)
**A:** 30 seconds, configurable per-agent via `SessionConfig.heartbeatInterval` and reflected in the attestation's `heartbeatInterval` field. Rationale: balances liveness visibility with noise; 30s is fast enough to detect outages within a minute, slow enough to avoid overhead.

**Q: How should content type allowlist updates be surfaced?** (PRD Open Questions)
**A:** Adding content types to the allowlist is a material change that produces a new attestation. The attestation's `contentTypes` array reflects the current effective list, and `previousAttestationId` creates a diff chain. The broker logs the delta internally. Rationale: consistent with the materiality rules -- any change to what an agent can see is material.

## Deferred

- **Conflict and rate_limit error categories**: The v0 taxonomy covers 7 categories. `conflict` (AlreadyExistsError) and `rate_limit` (RateLimitError) will be added when transports mature and produce those conditions. Adding them now would create dead code.
- **Network error category**: Deferred until the broker has external service dependencies that produce transient network failures distinct from timeouts.
- **Custom content type registration API**: The `CONTENT_TYPE_SCHEMAS` record is extensible at the code level. A runtime registration API (e.g., `registerContentType(id, schema)`) is deferred to Phase 2 when plugin architecture is designed.
- **Attestation signature schema**: The attestation schema defines the payload shape. The signed envelope schemas (`SignedAttestationEnvelope`, `SignedRevocationEnvelope`) live in `@xmtp-broker/contracts` as protocol wire formats.
- **Zod-to-JSON-Schema utility**: The `zodToJsonSchema()` conversion for MCP is a transport concern. This package provides the Zod schemas; the MCP adapter converts them.

## Testing Strategy

### What to Test

1. **Schema validation** -- Every schema accepts valid input and rejects invalid input. Test boundary conditions (empty arrays, null vs missing, datetime format).
2. **Type inference** -- Compile-time tests that `z.infer<typeof Schema>` produces the expected shape. Use `expectTypeOf` from `bun:test`.
3. **Error factories** -- Each `create()` factory produces an error with the correct `_tag`, `code`, `category`, and `context`.
4. **Cross-transport metadata** -- `errorCategoryMeta()` returns correct codes for each category.
5. **Discriminated unions** -- `BrokerEvent` and `HarnessRequest` correctly discriminate on `type`. `RequestResponse` discriminates on `ok`.
6. **Content type regex** -- `ContentTypeId` accepts valid XMTP content type strings and rejects malformed ones.

### Key Test Scenarios

```typescript
// Schema validation
expect(ViewMode.safeParse("full").success).toBe(true);
expect(ViewMode.safeParse("invalid").success).toBe(false);

// Nullable fields require explicit null
expect(AttestationSchema.safeParse({ ...validAttestation, buildProvenanceRef: undefined }).success)
  .toBe(false);
expect(AttestationSchema.safeParse({ ...validAttestation, buildProvenanceRef: null }).success)
  .toBe(true);

// Error factory
const err = GrantDeniedError.create("send", "messaging");
expect(err._tag).toBe("GrantDeniedError");
expect(err.category).toBe("permission");
expect(err.code).toBe(1210);

// Content type ID validation
expect(ContentTypeId.safeParse("xmtp.org/text:1.0").success).toBe(true);
expect(ContentTypeId.safeParse("invalid").success).toBe(false);
expect(ContentTypeId.safeParse("xmtp.org/text").success).toBe(false);
```

### Test Utilities

Export test fixtures for use by downstream packages:

```typescript
/** Valid attestation fixture for testing. */
function createTestAttestation(overrides?: Partial<Attestation>): Attestation;

/** Valid view config fixture. */
function createTestViewConfig(overrides?: Partial<ViewConfig>): ViewConfig;

/** Valid grant config fixture. */
function createTestGrantConfig(overrides?: Partial<GrantConfig>): GrantConfig;

/** Valid session token fixture. */
function createTestSessionToken(overrides?: Partial<SessionToken>): SessionToken;
```

These live in `src/__tests__/fixtures.ts` and are exported from a `test-utils` subpath export so downstream packages can import them without pulling in test runner dependencies.

## File Layout

```
packages/schemas/
  package.json
  tsconfig.json
  src/
    index.ts                    # Re-exports all public API
    content-types.ts            # ContentTypeId, payloads, BASELINE_CONTENT_TYPES, registry
    view.ts                     # ViewMode, ThreadScope, ContentTypeAllowlist, ViewConfig
    grant.ts                    # MessagingGrant, GroupManagementGrant, ToolGrant, EgressGrant, GrantConfig
    attestation.ts              # InferenceMode, ContentEgressScope, RetentionAtProvider,
                                # HostingMode, TrustTier, RevocationRules, AttestationSchema
    session.ts                  # SessionConfig, SessionToken, SessionState
    reveal.ts                   # RevealScope, RevealRequest, RevealGrant, RevealState
    revocation.ts               # AgentRevocationReason, SessionRevocationReason, RevocationAttestation
    events.ts                   # All event schemas, BrokerEvent union
    requests.ts                 # All request schemas, HarnessRequest union
    response.ts                 # RequestSuccess, RequestFailure, RequestResponse
    errors/
      index.ts                  # Re-exports all error types
      category.ts               # ErrorCategory, ErrorCategoryMeta, errorCategoryMeta()
      base.ts                   # BrokerError interface, AnyBrokerError union, matchError()
      validation.ts             # ValidationError, AttestationError
      not-found.ts              # NotFoundError
      permission.ts             # PermissionError, GrantDeniedError
      auth.ts                   # AuthError, SessionExpiredError
      internal.ts               # InternalError
      timeout.ts                # TimeoutError
      cancelled.ts              # CancelledError
    __tests__/
      content-types.test.ts
      view.test.ts
      grant.test.ts
      attestation.test.ts
      session.test.ts
      reveal.test.ts
      revocation.test.ts
      events.test.ts
      requests.test.ts
      response.test.ts
      errors.test.ts
      fixtures.ts               # Test fixtures, exported via subpath
```

Each source file stays well under 200 LOC. The `errors/` directory splits error classes by category for clear ownership and small diffs.
