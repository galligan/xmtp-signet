# v1 Phase 1 Execution Plan — Foundation Schemas + Contracts

**Version:** 1.0
**Created:** 2026-03-23
**Status:** Ready to execute
**Prerequisite:** All v0 PRs merged, `gt sync -f` to clean local branches

## Overview

Phase 1 establishes the v1 type foundation. New schemas for resource IDs, permission scopes, operators, policies, credentials, seal v2, and network ID mapping. Updated contracts for operator/policy/credential managers. Complete cutover — v0 schema files are replaced, not extended.

This is schema-only. No runtime behavior changes. Downstream packages will have type errors until later phases rebuild them.

Phase 1 delivers:

1. **Resource ID system** — prefixed UUIDs (`op_`, `cred_`, `conv_`, etc.) with short ID resolution
2. **Permission scopes** — 30 scopes across 6 categories, deny-wins resolution
3. **Operator schema** — role hierarchy (operator/admin/superadmin), scope modes (per-chat/shared)
4. **Policy schema** — reusable permission bundles with inline override support
5. **Credential schema** — replaces session model, token-as-capability
6. **Seal v2 schema** — chaining with inline diffs, message-seal binding
7. **Network ID mapping** — bidirectional xmtp_ ↔ local ID resolution
8. **Updated contracts** — service interfaces for the new domain model
9. **Foundation tests** — schema validation + contract tests

## Stack

```text
main
  └── v1/resource-ids           Step 1: Prefixed UUID system + ID resolution
       └── v1/permission-scopes  Step 2: 30 scopes, 6 categories
            └── v1/operator-schema  Step 3: Operator + roles + scope modes
                 └── v1/policy-schema  Step 4: Policy as first-class resource
                      └── v1/credential-schema  Step 5: Credential replacing session
                           └── v1/seal-v2-schema  Step 6: Seal chaining + message binding
                                └── v1/id-mapping-schema  Step 7: Network ↔ local ID mapping
                                     └── v1/contracts-update  Step 8: Service interfaces
                                          └── v1/phase1-tests  Step 9: Schema + contract tests
```

9 branches, 9 commits, 9 PRs.

## Pre-Flight Checklist

```bash
gt sync -f
bun run build
bun run test
bun run typecheck
bun run lint
```

## Agent Roles

- **Orchestrator** (main context): sequences steps, runs all git/gt commands, submits PRs
- **Implementer** (subagent): writes code for a single step — NO git operations
- **Reviewer** (subagent): reviews each PR before submit — NO git operations

### Git Discipline

- Only the orchestrator runs `gt`/`git` commands — subagents never touch git
- Subagents write code, orchestrator commits and submits
- One commit per branch, one branch per PR

### Graphite Workflow

```bash
# Per step (orchestrator only)
gt create 'v1/branch-name'
# ... implementer writes code ...
gt modify -a -c -m "feat(scope): description"

# After all steps
gt submit --stack --no-interactive --draft
```

### Review Protocol (per step)

1. Implementer writes code
2. `bun run check` must pass (build + lint + typecheck + test + docs:check)
3. Reviewer subagent reviews the diff
4. Fix any issues found
5. Move to next step

### Clean Break

This is a complete cutover. Existing schema files are replaced, not extended. Downstream packages (`sessions`, `policy`, `seals`, `core`, `cli`, etc.) will have type errors until their phases land. That's expected — Phase 1 only needs `packages/schemas/` and `packages/contracts/` to compile and pass tests internally.

---

## Step 1: Resource ID System

**Branch:** `v1/resource-ids`
**Scope:** `packages/schemas/`
**~150 LOC**

### Context

The v1 architecture uses prefixed UUIDs for all resources. Short IDs are accepted everywhere — minimum chars needed for uniqueness. This is the foundation that all other schemas depend on.

### Changes

**New file: `packages/schemas/src/resource-id.ts`**

- `RESOURCE_PREFIXES` const map: `op_`, `inbox_`, `conv_`, `policy_`, `cred_`, `seal_`, `key_`, `msg_`, `xmtp_`
- `ResourcePrefix` type (union of all prefix values)
- `createResourceId(prefix)` → `"{prefix}{8-hex-chars}"` using `crypto.randomBytes`
- `parseResourceId(id)` → `{ prefix, shortId, fullId }` — validates prefix exists
- `resolveShortId(shortId, candidates)` → exact match, unique prefix match, or ambiguity error
- Per-prefix Zod schemas: `OperatorId`, `InboxId`, `ConversationId`, `PolicyId`, `CredentialId`, `SealId`, `KeyId`, `MessageId`, `NetworkId`
- `AnyResourceId` union schema

**Update: `packages/schemas/src/index.ts`** — Export all resource ID types and utilities.

**Commit:** `feat(schemas): prefixed resource ID system with short ID resolution`

**Success gate:** `createResourceId("op_")` produces valid IDs. `parseResourceId` round-trips. Short ID resolution works with ambiguity detection. All per-prefix schemas validate correct/incorrect prefixes.

---

## Step 2: Permission Scopes

**Branch:** `v1/permission-scopes`
**Scope:** `packages/schemas/`
**~200 LOC**

### Context

The v0 permission model used `ViewConfig` (mode, thread scopes, content type allowlist) and `GrantConfig` (messaging, group management, tool, egress grants). v1 replaces this with 30 flat permission scopes across 6 categories, with deny-wins resolution.

### Changes

**New file: `packages/schemas/src/permission-scopes.ts`**

Six categories, 30 scopes:

| Category | Scopes |
|----------|--------|
| `messaging` | `send`, `reply`, `react`, `read-receipt`, `attachment` |
| `group-management` | `add-member`, `remove-member`, `promote-admin`, `demote-admin`, `update-permission` |
| `metadata` | `update-name`, `update-description`, `update-image` |
| `access` | `invite`, `join`, `leave`, `create-group`, `create-dm` |
| `observation` | `read-messages`, `read-history`, `list-members`, `list-conversations`, `view-permissions`, `stream-messages`, `stream-conversations` |
| `egress` | `forward-to-provider`, `store-excerpts`, `use-for-memory`, `quote-revealed`, `summarize` |

Types and utilities:
- `ScopeCategory` Zod enum
- `PermissionScope` Zod enum (all 30)
- `SCOPES_BY_CATEGORY` map: category → scope[]
- `ScopeSet` schema: `{ allow: PermissionScope[], deny: PermissionScope[] }`
- `resolveScopeSet(allow, deny)` → effective `Set<PermissionScope>` (deny wins)
- `isScopeAllowed(scope, resolved)` → boolean
- `isScopeInCategory(scope, category)` → boolean

**Delete: `packages/schemas/src/view.ts`** — Replaced by scope modes on operators + permission scopes.

**Delete: `packages/schemas/src/grant.ts`** — Replaced by the 30 permission scopes.

**Update: `packages/schemas/src/index.ts`** — Remove view/grant exports, add permission scope exports.

**Commit:** `feat(schemas): permission scope enums with 30 scopes across 6 categories`

**Success gate:** All 30 scopes parse. Deny-wins resolution works. Category lookup correct. `view.ts` and `grant.ts` deleted.

**Gotchas:**
- The `reveal.ts` schema references `ViewMode` — update reveal to use `ScopeMode` or inline the concept. Handle in this step since it's a direct dependency.
- `events.ts` and `requests.ts` reference `ViewConfig`/`GrantConfig` — these will break. Don't fix them yet (Step 6 handles event/request updates).

---

## Step 3: Operator Schema

**Branch:** `v1/operator-schema`
**Scope:** `packages/schemas/`
**~180 LOC**

### Changes

**New file: `packages/schemas/src/operator.ts`**

- `OperatorRole` Zod enum: `"operator"`, `"admin"`, `"superadmin"`
- `ScopeMode` Zod enum: `"per-chat"`, `"shared"`
- `OperatorStatus` Zod enum: `"active"`, `"suspended"`, `"removed"`
- `WalletProvider` Zod enum: `"internal"`, `"ows"`
- `OperatorConfig` schema: `{ label, role, scopeMode, provider?, walletId? }`
- `OperatorRecord` schema: `{ id: OperatorId, config, createdAt, createdBy, status }`
- `createdBy` is `OperatorId | "owner"` (owner creates first admin, admins create operators)

**Update: `packages/schemas/src/index.ts`** — Export operator types.

**Commit:** `feat(schemas): operator schema with role hierarchy and scope modes`

**Success gate:** Valid operator configs parse. Invalid roles rejected (`"god"` → error). Status values validate. `createdBy` accepts both operator IDs and `"owner"`.

---

## Step 4: Policy Schema

**Branch:** `v1/policy-schema`
**Scope:** `packages/schemas/`
**~120 LOC**

### Changes

**New file: `packages/schemas/src/policy.ts`**

- `PolicyConfig` schema: `{ label, allow: PermissionScope[], deny: PermissionScope[] }`
- `PolicyRecord` schema: `{ id: PolicyId, config, createdAt, updatedAt }`
- `resolvePolicy(policy, inlineAllow?, inlineDeny?)` → `ScopeSet`
  - Merges: policy.allow + inlineAllow → combined allow
  - Merges: policy.deny + inlineDeny → combined deny
  - Deny from either source wins

**Update: `packages/schemas/src/index.ts`** — Export policy types.

**Commit:** `feat(schemas): policy schema as reusable permission bundles`

**Success gate:** Policy + inline override merging works. Deny from either source wins. Empty policy + inline scopes works. Policy without inline works.

---

## Step 5: Credential Schema

**Branch:** `v1/credential-schema`
**Scope:** `packages/schemas/`
**~200 LOC**

### Context

The session concept is replaced by credentials. A credential is a time-bound, scoped pass issued to an operator for specific chats. Like a backstage pass: who you are, where you can go, what you can do, when it expires.

### Changes

**New file: `packages/schemas/src/credential.ts`** (replaces `session.ts`)

- `CredentialStatus` Zod enum: `"pending"`, `"active"`, `"expired"`, `"revoked"`
- `CredentialConfig` schema:
  ```
  { operatorId: OperatorId, chatIds: ConversationId[], policyId?: PolicyId,
    allow?: PermissionScope[], deny?: PermissionScope[], ttlSeconds?: number (default 3600) }
  ```
- `CredentialRecord` schema:
  ```
  { id: CredentialId, config, inboxIds: InboxId[], status, issuedAt, expiresAt, issuedBy: OperatorId }
  ```
- `CredentialToken` schema:
  ```
  { credentialId, operatorId, fingerprint, issuedAt, expiresAt }
  ```
- `IssuedCredential` schema: `{ token: string, credential: CredentialRecord }`

**Delete: `packages/schemas/src/session.ts`**

**Update: `packages/schemas/src/index.ts`** — Remove session exports, add credential exports.

**Commit:** `feat(schemas): credential schema replacing session model`

**Success gate:** Credential configs validate. Status transitions correct. Token schema parses. Old `session.ts` deleted.

**Gotchas:**
- `events.ts` references `SessionStartedEvent`, `SessionExpiredEvent`, etc. — these will break. Step 6 handles event updates.
- `requests.ts` references `HeartbeatRequest` — stays as-is (heartbeat concept is credential-agnostic).
- `revocation.ts` references `SessionRevocationReason` — Step 6 updates this.

---

## Step 6: Seal v2 Schema

**Branch:** `v1/seal-v2-schema`
**Scope:** `packages/schemas/`
**~150 LOC**

### Context

v0 seals are flat: one seal per session+group with a signed payload. v1 adds chaining (each seal references its predecessor with the full previous payload inline), delta computation, and message-seal binding.

### Changes

**Rewrite: `packages/schemas/src/seal.ts`**

- `SealPayload` schema:
  ```
  { sealId: SealId, credentialId, operatorId, chatId: ConversationId, scopeMode,
    permissions: ScopeSet, adminAccess?: { operatorId, expiresAt }, issuedAt }
  ```
- `SealDelta` schema: `{ added: PermissionScope[], removed: PermissionScope[], changed: [{ scope, from, to }] }`
- `SealChain` schema: `{ current: SealPayload, previous?: SealPayload, delta: SealDelta }`
- `MessageSealBinding` schema: `{ sealRef: SealId, sealSignature: string }`
- `SealVerificationStatus` Zod enum: `"valid"`, `"superseded"`, `"revoked"`, `"missing"`
- `SealEnvelope` schema: `{ chain: SealChain, signature, keyId: KeyId, algorithm: "Ed25519" }`

**Update: `packages/schemas/src/revocation.ts`**

- Replace `SessionRevocationReason` → `CredentialRevocationReason`
- Replace session references → credential references
- Keep `AgentRevocationReason` (still relevant)
- `RevocationSeal` references `CredentialId` instead of `sessionId`

**Update: `packages/schemas/src/events.ts`**

- Replace `SessionStartedEvent` → `CredentialIssuedEvent`
- Replace `SessionExpiredEvent` → `CredentialExpiredEvent`
- Replace `SessionReauthRequiredEvent` → `CredentialReauthRequiredEvent`
- Update `SealStampedEvent` to use `SealChain`
- Update `SignetEvent` union with new event types

**Update: `packages/schemas/src/requests.ts`**

- Update `HarnessRequest` to reference credential concepts where it referenced sessions
- Keep `HeartbeatRequest` (credential-agnostic)
- Keep `SendMessageRequest`, `SendReactionRequest`, `SendReplyRequest` (unchanged)
- Update `UpdateViewRequest` → `UpdateScopesRequest` or remove if no longer needed
- Keep `ConfirmActionRequest` (unchanged)

**Update: `packages/schemas/src/index.ts`** — Updated exports for all changed files.

**Commit:** `feat(schemas): seal v2 with chaining, inline diffs, and message binding`

**Success gate:** Seal chaining validates. Delta schema correct. Message binding parses. Revocation references credentials. Events and requests compile with new types.

**Gotchas:**
- This is the largest step — it touches seal, revocation, events, and requests. If it feels too big, split events/requests into a separate step.
- `reveal.ts` may need minor updates if it referenced `ViewMode` — check and fix.
- The `content-types.ts` file should be unaffected.

---

## Step 7: Network ID Mapping Schema

**Branch:** `v1/id-mapping-schema`
**Scope:** `packages/schemas/`
**~80 LOC**

### Changes

**New file: `packages/schemas/src/id-mapping.ts`**

- `IdMappingResourceType` Zod enum: `"message"`, `"conversation"`, `"inbox"`
- `IdMapping` schema: `{ networkId: NetworkId, localId: AnyResourceId, resourceType, createdAt }`
- `IdMappingStore` TypeScript interface (not Zod — this is a runtime contract):
  ```typescript
  interface IdMappingStore {
    set(networkId: string, localId: string, resourceType: string): void;
    getLocal(networkId: string): string | null;
    getNetwork(localId: string): string | null;
    resolve(id: string): { networkId: string; localId: string } | null;
  }
  ```

**Update: `packages/schemas/src/index.ts`** — Export ID mapping types.

**Commit:** `feat(schemas): network ID to local ID mapping schema`

**Success gate:** IdMapping schema validates. Store interface compiles. Bidirectional resolution contract is clear.

---

## Step 8: Updated Contracts

**Branch:** `v1/contracts-update`
**Scope:** `packages/contracts/`
**~200 LOC**

### Changes

**Rewrite: `packages/contracts/src/services.ts`**

- `SignetCore` — keep as-is (XMTP client lifecycle doesn't change)
- `CredentialManager` (replaces `SessionManager`):
  - `issue(config)`, `list(operatorId?)`, `lookup(credentialId)`, `lookupByToken(token)`
  - `revoke(credentialId, reason)`, `update(credentialId, changes)`, `renew(credentialId)`
- `OperatorManager`: `create`, `list`, `lookup`, `update`, `remove`
- `PolicyManager`: `create`, `list`, `lookup`, `update`, `remove`
- `ScopeGuard`: `check(scope, credentialId)`, `effectiveScopes(credentialId)`
- `SealManager` — update to reference `CredentialId` instead of `sessionId`

**Update: `packages/contracts/src/handler-types.ts`**

- `HandlerContext`: add `operatorId?: OperatorId`, `credentialId?: CredentialId`
- Remove `sessionId` (clean break)

**Rename: `packages/contracts/src/session-types.ts` → `credential-types.ts`**

- `CredentialRecord` (runtime-enriched): extends schema record with computed fields (`effectiveScopes`, `isExpired`)

**Update: `packages/contracts/src/seal-envelope.ts`** — Reference `CredentialId` instead of `sessionId`.

**Update: `packages/contracts/src/policy-types.ts`** — Update if it references v0 types.

**Update: `packages/contracts/src/providers.ts`** — Update `RevealStateStore` if it references sessions.

**Update: `packages/contracts/src/index.ts`** — Updated exports.

**Commit:** `feat(contracts): v1 service interfaces for operator, policy, and credential`

**Success gate:** All contract types compile. Service interfaces are complete. No circular deps. `packages/contracts && bun run typecheck` passes.

---

## Step 9: Phase 1 Tests

**Branch:** `v1/phase1-tests`
**Scope:** `packages/schemas/src/__tests__/`, `packages/contracts/src/__tests__/`
**~200 LOC**

### Changes

**New test files:**

| File | Covers |
|------|--------|
| `schemas/src/__tests__/resource-id.test.ts` | Generation, parsing, short ID resolution, ambiguity errors, all prefix types |
| `schemas/src/__tests__/permission-scopes.test.ts` | All 30 scopes parse, deny-wins, category grouping, scope set operations |
| `schemas/src/__tests__/operator.test.ts` | Role validation, scope modes, status transitions, config defaults |
| `schemas/src/__tests__/policy.test.ts` | Policy creation, inline override merging, deny precedence |
| `schemas/src/__tests__/credential.test.ts` | Config validation, status lifecycle, token schema, expiry |
| `schemas/src/__tests__/seal-v2.test.ts` | Chain validation, delta schema, message binding, verification status |
| `schemas/src/__tests__/id-mapping.test.ts` | Schema validation, resource type enum |

**Delete old tests:** `session.test.ts`, `seal.test.ts`, `grant.test.ts`, `view.test.ts`

**Update existing tests:** `revocation.test.ts`, `events.test.ts`, `requests.test.ts` — update to use v1 types, or delete and rewrite if they're mostly v0-specific.

**Commit:** `test(schemas): v1 foundation schema validation and contract tests`

**Success gate:**
- `cd packages/schemas && bun test` passes
- `cd packages/contracts && bun test` passes
- `bun run typecheck` passes for schemas + contracts
- `bun run lint` passes for schemas + contracts

---

## Verification (Full Stack)

After all 9 PRs:

```bash
cd packages/schemas && bun test    # all schema tests pass
cd packages/contracts && bun test  # all contract tests pass
```

**Expected downstream breakage** (tracked by later phase epics):
- `packages/sessions` — imports SessionConfig, SessionManager
- `packages/policy` — imports ViewConfig, GrantConfig
- `packages/seals` — imports Seal, SealEnvelope
- `packages/core` — imports session types
- `packages/cli` — imports everything
- `packages/ws` — imports session types
- `packages/mcp` — imports session types
- `packages/sdk` — imports session types

---

## File Summary

| Step | New/Rewritten Files | Deleted Files |
|------|-------------------|---------------|
| 1 | `schemas/src/resource-id.ts` | — |
| 2 | `schemas/src/permission-scopes.ts` | `schemas/src/view.ts`, `schemas/src/grant.ts` |
| 3 | `schemas/src/operator.ts` | — |
| 4 | `schemas/src/policy.ts` | — |
| 5 | `schemas/src/credential.ts` | `schemas/src/session.ts` |
| 6 | `schemas/src/seal.ts` (rewrite), revocation/events/requests (update) | — |
| 7 | `schemas/src/id-mapping.ts` | — |
| 8 | `contracts/src/services.ts` (rewrite), handler-types, credential-types, seal-envelope, index | `contracts/src/session-types.ts` |
| 9 | 7+ test files | `session.test.ts`, `seal.test.ts`, `grant.test.ts`, `view.test.ts` |

## Step Summary

| Step | Branch | Focus | ~LOC |
|------|--------|-------|------|
| 1 | `v1/resource-ids` | Prefixed UUID system | 150 |
| 2 | `v1/permission-scopes` | 30 scopes, 6 categories | 200 |
| 3 | `v1/operator-schema` | Operator + roles + scope modes | 180 |
| 4 | `v1/policy-schema` | Policy as first-class resource | 120 |
| 5 | `v1/credential-schema` | Credential replacing session | 200 |
| 6 | `v1/seal-v2-schema` | Seal chaining + message binding | 150 |
| 7 | `v1/id-mapping-schema` | Network ↔ local ID mapping | 80 |
| 8 | `v1/contracts-update` | Service interfaces | 200 |
| 9 | `v1/phase1-tests` | Schema + contract tests | 200 |

9 branches, 9 commits, 9 PRs. ~1480 LOC total.
