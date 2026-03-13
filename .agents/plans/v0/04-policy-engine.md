# 04-policy-engine

**Package:** `@xmtp-broker/policy`
**Spec version:** 0.1.0

## Overview

The policy engine is the enforcement layer between the raw XMTP plane and the derived agent-facing plane. It has two jobs: filter what agents see (view projection) and validate what agents do (grant enforcement). Every message flowing from the network to an agent passes through the view projection pipeline. Every request flowing from an agent harness to the broker passes through the grant validation pipeline.

The engine is stateless per-invocation. Each pipeline stage is a pure function that takes input and configuration, returning a result. The only mutable state the engine owns is the reveal grant store, which tracks which content has been selectively disclosed to which agents. All other configuration (views, grants, content type allowlists) is owned by the session manager and passed in as arguments.

The policy engine does not know about WebSocket, MCP, or any transport. It does not know about XMTP message decoding. It receives already-decoded messages and typed harness requests, and returns typed results or errors.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` -- `PolicyDelta`, `RawMessage`, `RevealStateStore`, `GrantError` (canonical interface definitions)
- `@xmtp-broker/schemas` -- `ViewConfig`, `ViewMode`, `GrantConfig`, `ContentTypeId`, `BASELINE_CONTENT_TYPES`, `RevealRequest`, `RevealGrant`, `RevealState`, `MessageEvent`, `MessageVisibility`, `BrokerError`, `GrantDeniedError`, `ValidationError`, `PermissionError`
- `better-result` -- `Result`, `ok`, `err`

**Imported by:**
- `@xmtp-broker/ws` (transport adapter calls pipeline functions, orchestration)
- `@xmtp-broker/attestations` (imports `isMaterialChange` -- this package is the canonical owner of materiality logic)

## Public Interfaces

> **Note:** The following interfaces are canonically defined in `@xmtp-broker/contracts`: `PolicyDelta`, `RawMessage`, `RevealStateStore`, `GrantError`. This package implements them. This package is also the **canonical owner** of the `isMaterialChange` logic -- `@xmtp-broker/attestations` imports materiality from here rather than defining its own.

### View Projection Pipeline

```typescript
/** A raw message as received from the XMTP client, already decoded. */
interface RawMessage {
  readonly messageId: string;
  readonly groupId: string;
  readonly senderInboxId: string;
  readonly contentType: ContentTypeId;
  readonly content: unknown;
  readonly sentAt: string; // ISO 8601
  readonly threadId: string | null;
  readonly attestationId: string | null;
}

/** Result of projecting a raw message through the view pipeline. */
type ProjectionResult =
  | { readonly action: "emit"; readonly event: MessageEvent }
  | { readonly action: "drop" };

/**
 * Projects a raw message through the view filter, content type filter,
 * redaction logic, and reveal state to produce a derived event or drop.
 *
 * Pure function. No side effects.
 */
function projectMessage(
  message: RawMessage,
  view: ViewConfig,
  effectiveAllowlist: ReadonlySet<ContentTypeId>,
  revealState: RevealState,
): ProjectionResult;
```

### Individual Pipeline Stages

Each stage is exported for unit testing and composability.

```typescript
/**
 * Stage 1: Scope filter. Returns true if the message falls within
 * the view's thread scopes.
 */
function isInScope(
  message: Pick<RawMessage, "groupId" | "threadId">,
  scopes: readonly ThreadScope[],
): boolean;

/**
 * Stage 2: Content type filter. Returns true if the message's content
 * type is in the effective allowlist.
 */
function isContentTypeAllowed(
  contentType: ContentTypeId,
  allowlist: ReadonlySet<ContentTypeId>,
): boolean;

/**
 * Stage 3: Visibility resolver. Determines the MessageVisibility
 * for this message given the view mode and reveal state.
 */
function resolveVisibility(
  message: Pick<RawMessage, "messageId" | "groupId" | "threadId" | "senderInboxId" | "contentType">,
  mode: ViewMode,
  revealState: RevealState,
): MessageVisibility;

/**
 * Stage 4: Content projector. Applies redaction or summary
 * based on the resolved visibility. Returns the content to emit.
 */
function projectContent(
  content: unknown,
  contentType: ContentTypeId,
  visibility: MessageVisibility,
): unknown;
```

### Content Type Allowlist Resolution

```typescript
/** Broker-level content type configuration. */
interface BrokerContentTypeConfig {
  readonly allowlist: ReadonlySet<ContentTypeId>;
}

/**
 * Computes the effective allowlist as the intersection of
 * baseline, broker-level, and agent view-level allowlists.
 *
 * effectiveAllowlist = baseline ∩ broker ∩ agent
 *
 * If the broker expands beyond baseline, the intersection still
 * holds -- only types present in all three tiers pass.
 */
function resolveEffectiveAllowlist(
  baseline: readonly ContentTypeId[],
  brokerConfig: BrokerContentTypeConfig,
  agentAllowlist: readonly ContentTypeId[],
): ReadonlySet<ContentTypeId>;
```

### Grant Validation Pipeline

```typescript
/** The set of policy errors the grant enforcer can produce. */
type GrantError = GrantDeniedError | ValidationError | PermissionError;

/**
 * Validates a send_message request against the active grant.
 */
function validateSendMessage(
  request: { groupId: string; contentType: ContentTypeId },
  grant: GrantConfig,
  view: ViewConfig,
): Result<{ draftOnly: boolean }, GrantError>;

/**
 * Validates a send_reaction request against the active grant.
 */
function validateSendReaction(
  request: { groupId: string; messageId: string },
  grant: GrantConfig,
  view: ViewConfig,
): Result<void, GrantError>;

/**
 * Validates a send_reply request against the active grant.
 */
function validateSendReply(
  request: { groupId: string; messageId: string; contentType: ContentTypeId },
  grant: GrantConfig,
  view: ViewConfig,
): Result<{ draftOnly: boolean }, GrantError>;

/**
 * Validates a group management action against the active grant.
 */
function validateGroupManagement(
  action: "addMembers" | "removeMembers" | "updateMetadata" | "inviteUsers",
  request: { groupId: string },
  grant: GrantConfig,
  view: ViewConfig,
): Result<void, GrantError>;

/**
 * Validates a tool invocation against the active grant.
 */
function validateToolUse(
  toolId: string,
  parameters: Record<string, unknown> | null,
  grant: GrantConfig,
): Result<void, GrantError>;

/**
 * Validates an egress action against the active grant.
 */
function validateEgress(
  action: "storeExcerpts" | "useForMemory" | "forwardToProviders" | "quoteRevealed" | "summarize",
  grant: GrantConfig,
): Result<void, GrantError>;
```

### Reveal State Manager

```typescript
/**
 * In-memory reveal state store scoped to an agent session.
 * Persisted by the session manager; the policy engine owns the logic.
 */
interface RevealStateStore {
  /** Add a reveal grant. */
  grant(reveal: RevealGrant, request: RevealRequest): void;

  /** Check if a specific message is revealed. */
  isRevealed(
    messageId: string,
    groupId: string,
    threadId: string | null,
    senderInboxId: string,
    contentType: ContentTypeId,
  ): boolean;

  /** Remove expired reveals. Returns count of removed grants. */
  expireStale(now: Date): number;

  /** Snapshot the current state for serialization. */
  snapshot(): RevealState;

  /** Restore from a serialized snapshot. */
  restore(state: RevealState): void;
}

/**
 * Creates a new reveal state store.
 */
function createRevealStateStore(): RevealStateStore;
```

### Materiality Classifier

```typescript
/** Description of a policy change for materiality classification. */
interface PolicyDelta {
  readonly field: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
}

/**
 * Classifies whether a set of policy changes is material
 * (triggers attestation) or routine (silent).
 */
function isMaterialChange(deltas: readonly PolicyDelta[]): boolean;

/**
 * Classifies whether a policy change requires session
 * reauthorization (privilege escalation).
 */
function requiresReauthorization(deltas: readonly PolicyDelta[]): boolean;
```

## Zod Schemas

This package defines no new Zod schemas. All schemas are imported from `@xmtp-broker/schemas` (see [02-schemas.md](02-schemas.md)). The `RawMessage` and `PolicyDelta` interfaces are internal TypeScript types, not schema-validated boundaries -- they flow between trusted internal components.

## Behaviors

### View Projection Pipeline

Each raw message passes through four stages. A drop at any stage stops the pipeline.

```
Raw Message
    │
    ▼
┌──────────────┐
│ 1. Scope     │──── out of scope ──── DROP
│    Filter    │
└──────┬───────┘
       │ in scope
       ▼
┌──────────────┐
│ 2. Content   │──── type not allowed ── DROP
│    Type      │
└──────┬───────┘
       │ type allowed
       ▼
┌──────────────┐
│ 3. Visibility│──── resolves to "hidden" with no reveal ── DROP
│    Resolver  │
└──────┬───────┘
       │ visibility determined
       ▼
┌──────────────┐
│ 4. Content   │──── applies redaction/summary if needed
│    Projector │
└──────┬───────┘
       │
       ▼
  MessageEvent (emit)
```

#### Stage 1: Scope Filter

Checks whether the message's `groupId` (and optionally `threadId`) falls within any of the view's `threadScopes`. A `ThreadScope` with `threadId: null` matches all threads in that group. A `ThreadScope` with a specific `threadId` matches only messages in that thread.

#### Stage 2: Content Type Filter

Checks whether the message's `contentType` is in the effective allowlist. The effective allowlist is pre-computed via `resolveEffectiveAllowlist` when the session is established or the view is updated. Unknown content types are dropped silently -- this is the default-deny behavior.

#### Stage 3: Visibility Resolver

Determines `MessageVisibility` based on view mode and reveal state:

| View Mode      | Default Visibility | With Active Reveal |
|----------------|--------------------|--------------------|
| `full`         | `visible`          | `visible`          |
| `thread-only`  | `visible`*         | `visible`          |
| `redacted`     | `redacted`         | `revealed`         |
| `reveal-only`  | `hidden`           | `revealed`         |
| `summary-only` | `redacted`**       | `revealed`         |

\* `thread-only` messages already passed the scope filter, so they are visible.

\** `summary-only` uses `redacted` visibility with summarized content in stage 4.

If visibility resolves to `hidden` and no reveal grant covers the message, the pipeline returns `DROP`.

#### Stage 4: Content Projector

Transforms content based on resolved visibility:

- `visible` / `historical` / `revealed`: content passes through unchanged.
- `redacted`: content is replaced with `null`. The `contentType` and metadata (sender, timestamp) are preserved.
- `hidden`: unreachable (dropped in stage 3).

**`summary-only` mode is Phase 2 behavior.** The mode exists in the schema for forward compatibility, but in v0 the broker returns a `ValidationError` if a harness attempts to create a session or update a view with `mode: "summary-only"`. This prevents harnesses from relying on placeholder behavior that will change semantically in Phase 2.

### Grant Validation Pipeline

Every harness request is validated before execution:

```
Harness Request
    │
    ▼
┌──────────────────┐
│ 1. Scope Check   │──── group not in view ──── PermissionError
│    (group in      │
│     view scopes?) │
└──────┬───────────┘
       │ in scope
       ▼
┌──────────────────┐
│ 2. Grant Check   │──── grant denied ──── GrantDeniedError
│    (operation     │
│     permitted?)   │
└──────┬───────────┘
       │ permitted
       ▼
┌──────────────────┐
│ 3. Draft Check   │──── draftOnly=true ──── return { draftOnly: true }
│    (requires      │
│     confirmation?)│
└──────┬───────────┘
       │
       ▼
  Result<void | { draftOnly: boolean }>
```

#### Scope Check

The request's `groupId` must appear in at least one of the view's `threadScopes`. An agent cannot send messages to groups it cannot see. This is a hard boundary -- even if the grant says `send: true`, the agent cannot target a group outside its view.

#### Grant Check Details

**Messaging grants:**
- `send_message`: requires `grant.messaging.send === true`
- `send_reply`: requires `grant.messaging.reply === true`
- `send_reaction`: requires `grant.messaging.react === true`

**Group management grants:** each action maps directly to its boolean field:
- `addMembers` -> `grant.groupManagement.addMembers`
- `removeMembers` -> `grant.groupManagement.removeMembers`
- `updateMetadata` -> `grant.groupManagement.updateMetadata`
- `inviteUsers` -> `grant.groupManagement.inviteUsers`

**Tool grants:** the `toolId` must appear in `grant.tools.scopes` with `allowed: true`. If the tool scope has non-null `parameters`, the request parameters must be a subset of the permitted constraints.

**Egress grants:** each egress action maps directly to its boolean field on `grant.egress`.

#### Draft-Only Enforcement

When `grant.messaging.draftOnly === true`, send and reply operations succeed at the grant check but return `{ draftOnly: true }`. The transport layer holds the message and emits an `action.confirmation_required` event to the owner. The message is only sent to the group after owner confirmation via `confirm_action`.

### Content Type Allowlist Resolution

The three-tier intersection ensures conservative defaults:

```
  BASELINE_CONTENT_TYPES (XIP-accepted, hardcoded)
           ∩
  Broker config allowlist (operator-scoped)
           ∩
  Agent view.contentTypes (owner-scoped)
           =
  Effective allowlist
```

Key behaviors:
- If the broker config is a superset of baseline, baseline still constrains.
- If the agent view requests types the broker doesn't allow, those are silently excluded.
- When `BASELINE_CONTENT_TYPES` is updated (new XIP type accepted), existing agents do not automatically see it. The broker updates its allowlist, but each agent's `view.contentTypes` must be explicitly updated by the owner.
- An empty intersection is a `ValidationError` at session creation time -- the session cannot start if the agent would see nothing.

### Reveal State Management

#### Reveal Flow

```
Group member ──reveal_content request──▶ Broker
                                           │
                                           ▼
                                   ┌───────────────┐
                                   │ Authorization  │
                                   │ (is requestor  │
                                   │  group owner?) │
                                   └───────┬───────┘
                                           │ yes
                                           ▼
                                   ┌───────────────┐
                                   │ Create         │
                                   │ RevealGrant    │
                                   └───────┬───────┘
                                           │
                                           ▼
                                   ┌───────────────┐
                                   │ Store in       │
                                   │ RevealState    │
                                   └───────┬───────┘
                                           │
                                           ▼
                              Replay affected messages
                              through projection pipeline
                                    with new state
                                           │
                                           ▼
                              Emit RevealEvent(s) to harness
```

#### Who Can Reveal

In v0, only the agent's owner (the member identified by `ownerInboxId` in the attestation) can grant reveals. This matches the single-owner governance model.

#### Reveal Scope Resolution

When `isRevealed()` is called, the store checks active grants in order of specificity:

1. **message** scope: `targetId` matches the `messageId` exactly.
2. **thread** scope: `targetId` matches the message's `threadId`.
3. **sender** scope: `targetId` matches the message's `senderInboxId`.
4. **content-type** scope: `targetId` matches the message's `contentType`.
5. **time-window** scope: `targetId` is a start timestamp; the grant's `expiresAt` defines the end. The message's `sentAt` must fall within the window.

A message is revealed if any active (non-expired) grant covers it.

#### Persistence

The reveal state store is in-memory during a session. On session creation, the store is empty. The session manager serializes the store's snapshot when persisting session state and restores it on reconnection within the same session. Reveal grants do not survive session expiration -- a new session starts with no reveals.

### Materiality Classification

The classifier examines each `PolicyDelta` and returns `true` if any delta is material.

**Material fields** (trigger attestation):
- `view.mode`
- `view.threadScopes` (adding or removing scopes)
- `view.contentTypes` (adding types -- removing is also material since it changes what the agent sees)
- `grant.messaging.*` (any change)
- `grant.groupManagement.*` (any change)
- `grant.tools.scopes` (any change)
- `grant.egress.*` (any change)

**Routine fields** (silent):
- Session rotation (same view + grant)
- Heartbeat interval adjustment
- Internal broker state

**Reauthorization-required fields** (material + session termination):
- `view.mode` changing to a broader mode (e.g., `redacted` -> `full`, `reveal-only` -> `full`)
- `grant.egress.*` changing from `false` to `true`
- `grant.groupManagement.*` changing from `false` to `true`

The `requiresReauthorization` function checks a stricter subset: only privilege escalations (expanding from `false` to `true` or from a narrower to a broader mode). Privilege reductions are material (new attestation) but do not require reauthorization.

#### View Mode Ordering (narrow to broad)

```
reveal-only < summary-only < redacted < thread-only < full
```

A mode change is an escalation if the new mode is broader than the old mode in this ordering.

## Error Cases

| Scenario | Error | Category |
|----------|-------|----------|
| Message targets group not in view | `PermissionError` | permission |
| Send without `messaging.send` grant | `GrantDeniedError` | permission |
| Reply without `messaging.reply` grant | `GrantDeniedError` | permission |
| React without `messaging.react` grant | `GrantDeniedError` | permission |
| Group mgmt action without matching grant | `GrantDeniedError` | permission |
| Tool not in allowed scopes | `GrantDeniedError` | permission |
| Tool parameters exceed constraints | `ValidationError` | validation |
| Egress action without matching grant | `GrantDeniedError` | permission |
| Empty effective content type allowlist | `ValidationError` | validation |
| Reveal requested by non-owner | `PermissionError` | permission |
| Content type not in effective allowlist (send) | `ValidationError` | validation |
| View mode set to `summary-only` in v0 | `ValidationError` | validation |

All functions return `Result<T, E>`. No exceptions are thrown.

## Open Questions Resolved

**Q: How should content type allowlist updates be surfaced?** (PRD Open Questions)
**A:** Adding or removing content types from the effective allowlist is a material change that triggers a new attestation. The `resolveEffectiveAllowlist` function recomputes the intersection on every view update. If the result differs from the previous effective list, `isMaterialChange` returns `true`. The attestation's `contentTypes` field reflects the new effective list.

**Q: Should non-material view/grant changes be applied within an existing session?** (PRD Session section)
**A:** Yes. Non-material changes (e.g., adjusting a thread scope within the same groups, or minor grant tweaks that don't escalate privileges) are applied in-place and emit a `view.updated` or `grant.updated` event. Only escalations require session reauthorization. This is enforced by `requiresReauthorization` returning `false` for non-escalation changes.

**Q: How does summary-only mode work in v0?** (PRD View Modes)
**A:** In v0, `summary-only` is kept in the schema for forward compatibility but is not usable. If a harness attempts to create a session or update a view with `mode: "summary-only"`, the broker returns a `ValidationError`. Actual summarization (LLM-generated summaries) is deferred to Phase 2. The schema includes the value so the wire format is stable across versions.

## Deferred

- **LLM-powered summarization**: `summary-only` mode emits placeholders. Actual summary generation requires an inference pipeline, deferred to Phase 2.
- **Tool parameter constraint validation**: v0 checks that the `toolId` is allowed and that `parameters` is non-null if constrained. Deep parameter validation (e.g., "this integer must be < 100") is deferred.
- **Group governance beyond owner**: v0 only allows the owner to grant reveals and modify policy. Multi-member governance (approval thresholds, admin caps) is deferred.
- **Reveal history API**: The engine tracks active reveals but does not expose a history of past reveals. Forensic history is deferred.
- **Rate limiting on grant checks**: No per-agent rate limiting on request validation. Deferred until transport layer maturity.
- **Content type version negotiation**: The allowlist matches exact content type IDs including version. Version negotiation (e.g., accepting `text:1.1` when `text:1.0` is listed) is deferred.

## Testing Strategy

### What to Test

**Unit tests** for each pipeline stage in isolation, plus integration tests for the full pipeline.

### Key Test Scenarios

#### View Projection Pipeline

1. **Scope filter**: message in scope -> passes; message out of scope -> drops.
2. **Scope filter with null threadId**: `ThreadScope { groupId: "g1", threadId: null }` matches all threads in g1.
3. **Content type filter**: allowed type -> passes; unknown type -> drops (default-deny).
4. **Visibility resolver per mode**: each view mode produces correct visibility.
5. **Reveal overrides hidden**: `reveal-only` mode + active reveal grant -> `revealed`.
6. **Redaction replaces content**: `redacted` visibility -> content becomes `null`.
7. **Full pipeline integration**: raw message with various configs -> correct `ProjectionResult`.

#### Grant Validation Pipeline

8. **Send granted**: `messaging.send: true` -> success.
9. **Send denied**: `messaging.send: false` -> `GrantDeniedError`.
10. **Draft-only**: `messaging.draftOnly: true` -> success with `{ draftOnly: true }`.
11. **Group out of scope**: send to group not in view -> `PermissionError`.
12. **Group management**: each of 4 actions with grant true/false.
13. **Tool allowed**: toolId in scopes with `allowed: true` -> success.
14. **Tool denied**: toolId not in scopes -> `GrantDeniedError`.
15. **Egress**: each of 5 egress flags with true/false.

#### Content Type Allowlist

16. **Intersection**: baseline has 5, broker has 4, agent has 3 -> effective is intersection.
17. **Empty intersection**: -> `ValidationError`.
18. **Broker superset of baseline**: effective still bounded by baseline.

#### Reveal State

19. **Grant and query**: grant a message reveal -> `isRevealed` returns true.
20. **Thread reveal**: grant covers all messages in thread.
21. **Expiration**: expired reveal -> `isRevealed` returns false after `expireStale`.
22. **Snapshot/restore**: round-trip through `snapshot()` and `restore()`.

#### Materiality Classifier

23. **View mode change**: material = true, reauth depends on direction.
24. **Grant escalation**: `send: false -> true` is material + reauth.
25. **Grant reduction**: `send: true -> false` is material, no reauth.
26. **Session rotation**: same view+grant -> not material.
27. **Mode ordering**: verify `reveal-only < summary-only < redacted < thread-only < full`.

### Test Utilities

```typescript
/** Creates a RawMessage fixture. */
function createTestRawMessage(overrides?: Partial<RawMessage>): RawMessage;

/** Creates a minimal ViewConfig that passes all messages. */
function createPassthroughView(groupId: string): ViewConfig;

/** Creates a GrantConfig with all permissions enabled. */
function createFullGrant(): GrantConfig;

/** Creates a GrantConfig with all permissions denied. */
function createDenyAllGrant(): GrantConfig;
```

## File Layout

```
packages/policy/
  package.json
  tsconfig.json
  src/
    index.ts                        # Re-exports public API
    pipeline/
      project-message.ts            # projectMessage() orchestrator
      scope-filter.ts               # isInScope()
      content-type-filter.ts        # isContentTypeAllowed()
      visibility-resolver.ts        # resolveVisibility()
      content-projector.ts          # projectContent()
    grant/
      validate-send.ts              # validateSendMessage(), validateSendReply()
      validate-reaction.ts          # validateSendReaction()
      validate-group-management.ts  # validateGroupManagement()
      validate-tool.ts              # validateToolUse()
      validate-egress.ts            # validateEgress()
      scope-check.ts                # shared group-in-view check
    allowlist.ts                    # resolveEffectiveAllowlist()
    reveal-state.ts                 # RevealStateStore, createRevealStateStore()
    materiality.ts                  # isMaterialChange(), requiresReauthorization()
    types.ts                        # RawMessage, ProjectionResult, PolicyDelta, etc.
    __tests__/
      scope-filter.test.ts
      content-type-filter.test.ts
      visibility-resolver.test.ts
      content-projector.test.ts
      project-message.test.ts
      validate-send.test.ts
      validate-reaction.test.ts
      validate-group-management.test.ts
      validate-tool.test.ts
      validate-egress.test.ts
      allowlist.test.ts
      reveal-state.test.ts
      materiality.test.ts
      fixtures.ts                   # Test utilities
```

Each source file stays well under 200 LOC. The `pipeline/` and `grant/` directories separate the two main flows for clear ownership.
