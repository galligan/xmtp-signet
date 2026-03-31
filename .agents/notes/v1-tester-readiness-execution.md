# v1 Tester-Readiness Execution Guide

**Epic**: [#236](https://github.com/galligan/xmtp-signet/issues/236)
**Created**: 2026-03-30
**Status**: Ready for implementation

This document is the self-contained execution guide for closing the tester-readiness
gaps tracked in #236. An implementer should be able to work through the full
#237-#244 stack using this document without re-deciding semantics.

---

## Resolved Design Decisions

These decisions were made during planning and are baked into every issue.

| # | Decision | Resolution |
|---|----------|------------|
| 1 | CLI taxonomy | Action spec IDs are canonical (`operator.create`, `chat.create`, `message.send`). CLI uses short names via `CliSurface` overrides (`xs op`, `xs chat`, `xs msg`). MCP uses `operator_create`, `chat_create`, etc. |
| 2 | Message scope | Full surface: `send`, `list`, `info`, `reply`, `react`, `read` |
| 3 | Operator UX | Labels resolve to `op_` IDs. Operators must exist before cred issuance. |
| 4 | Policy UX | Named policies recommended, inline `--allow`/`--deny` as escape hatch |
| 5 | Seal behavior | Fail closed by default. Config/env bypass for dev. Mismatch flagging. Cryptographically verifiable. |
| 6 | Scope modes | Both per-chat and shared ship in tester release |
| 7 | Conv IDs | `conv_` is canonical local ID. Raw `groupId` never escapes core package. |

---

## Dependency Graph

```
#244 (conv_ IDs) ──┬──▶ #239 (message actions) ──┐
                    ├──▶ #241 (seals) ────────────┤
                    └──▶ #243 (QA/docs) ──────────┤
                                                   ▼
#237 (operator) ──▶ #238 (policy) ──┬──▶ #242 (CLI cutover)
                                    └──▶ #243              │
                                                           ▼
#239 (messages) ──────────────────────▶ #242               │
                                                           ▼
#240 (invites) ───────────────────────▶ #243 (release gate)
                                                           ▲
#242 (CLI cutover) ────────────────────────────────────────┘
```

## Execution Order — Sequential Stacked PRs

All work lands as a Graphite stack, one branch per issue, executed sequentially.
After each priority tier, run `/codex-review` before proceeding.

### P0 — Foundations (stack 1-2)

| Order | Issue | Branch | Depends on |
|-------|-------|--------|------------|
| 1 | #244 | `v1/conv-id-boundary` | — |
| 2 | #237 | `v1/operator-actions` | #244 (stacked on) |

**Review checkpoint**: `/codex-review` after #237 lands on stack.

### P1 — Domain surfaces (stack 3-6)

| Order | Issue | Branch | Depends on |
|-------|-------|--------|------------|
| 3 | #238 | `v1/policy-actions` | #237 |
| 4 | #239 | `v1/message-actions` | #238 |
| 5 | #240 | `v1/invite-host` | #239 |
| 6 | #241 | `v1/seal-wiring` | #240 |

**Review checkpoint**: `/codex-review` after #241 lands on stack.

### P2 — Integration and release gate (stack 7-8)

| Order | Issue | Branch | Depends on |
|-------|-------|--------|------------|
| 7 | #242 | `v1/cli-cutover` | #241 |
| 8 | #243 | `v1/qa-release-gate` | #242 |

**Review checkpoint**: `/codex-review` after #243 lands on stack.

---

## Canonical Action-Spec Naming Table

### Current specs (to rename)

| Current ID | New ID | CLI | MCP | Intent |
|------------|--------|-----|-----|--------|
| `conversation.create` | `chat.create` | `xs chat create` | `chat_create` | write |
| `conversation.list` | `chat.list` | `xs chat list` | `chat_list` | read |
| `conversation.info` | `chat.info` | `xs chat info` | `chat_info` | read |
| `conversation.join` | `chat.join` | `xs chat join` | `chat_join` | write |
| `conversation.invite` | `chat.invite` | `xs chat invite` | `chat_invite` | write |
| `conversation.add-member` | `chat.add-member` | `xs chat member add` | `chat_add_member` | write |
| `conversation.members` | `chat.members` | `xs chat member list` | `chat_members` | read |

### Existing specs (keep as-is)

| ID | CLI | MCP | Intent |
|----|-----|-----|--------|
| `credential.issue` | `xs cred issue` | `credential_issue` | write |
| `credential.list` | `xs cred list` | `credential_list` | read |
| `credential.lookup` | `xs cred info` | `credential_lookup` | read |
| `credential.revoke` | `xs cred revoke` | `credential_revoke` | destroy |
| `credential.updateScopes` | `xs cred update` | `credential_update_scopes` | write |
| `credential.reveal` | `xs cred reveal` | `credential_reveal` | write |
| `credential.updateClaims` | `xs cred update-claims` | `credential_update_claims` | write |
| `signet.status` | `xs status` | `signet_status` | read |
| `signet.stop` | `xs daemon stop` | `signet_stop` | write |
| `keys.rotate` | `xs key rotate` | `keys_rotate` | write |

### New specs to create

| ID | CLI | MCP | Intent | Issue |
|----|-----|-----|--------|-------|
| `operator.create` | `xs operator create` / `xs op create` | `operator_create` | write | #237 |
| `operator.list` | `xs operator list` / `xs op list` | `operator_list` | read | #237 |
| `operator.info` | `xs operator info` / `xs op info` | `operator_info` | read | #237 |
| `operator.update` | `xs operator update` / `xs op update` | `operator_update` | write | #237 |
| `operator.remove` | `xs operator remove` / `xs op rm` | `operator_remove` | destroy | #237 |
| `policy.create` | `xs policy create` | `policy_create` | write | #238 |
| `policy.list` | `xs policy list` | `policy_list` | read | #238 |
| `policy.info` | `xs policy info` | `policy_info` | read | #238 |
| `policy.update` | `xs policy update` | `policy_update` | write | #238 |
| `policy.remove` | `xs policy remove` / `xs policy rm` | `policy_remove` | destroy | #238 |
| `message.send` | `xs msg send` | `message_send` | write | #239 |
| `message.list` | `xs msg list` | `message_list` | read | #239 |
| `message.info` | `xs msg info` | `message_info` | read | #239 |
| `message.reply` | `xs msg reply` | `message_reply` | write | #239 |
| `message.react` | `xs msg react` | `message_react` | write | #239 |
| `message.read` | `xs msg read` | `message_read` | write | #239 |

---

## Per-Issue Implementation Guide

### #244 — conv_ ID boundary

**Goal**: Make `conv_` the canonical local conversation ID everywhere.

**Files to modify**:
- `packages/core/src/conversation-actions.ts` — wire `idMappings.set()` in create handler, add resolution in all handlers
- `packages/schemas/src/reveal.ts` — change `groupId: z.string()` → `ConversationId`
- `packages/cli/src/start.ts` — ensure `IdMappingStore` is created and passed to conversation actions
- `packages/core/src/id-mapping-store.ts` — no changes needed, already implemented

**Pattern**:
```typescript
// In chat.create handler, after XMTP group creation:
const localId = createResourceId("conversation"); // conv_<16hex>
await idMappings.set(networkGroupId, localId, "conversation");
return { chatId: localId, /* ... */ };

// In chat.info and other handlers, resolve conv_ → groupId:
const resolved = await idMappings.getNetwork(input.chatId);
if (Result.isError(resolved)) return Result.err(NotFoundError.create(...));
const groupId = resolved.value;
```

**Tests**:
- `conversation.create` returns `conv_` ID and stores mapping
- All actions accept `conv_` and resolve internally
- Invalid `conv_` IDs fail with `not_found`
- Existing tests updated to use `conv_` IDs

---

### #237 — Operator action surface

**Goal**: Expose operator CRUD via contract-first action specs.

**Files to create**:
- `packages/sessions/src/operator-actions.ts` — action spec definitions + handlers

**Files to modify**:
- `packages/sessions/src/index.ts` — export `createOperatorActions`
- `packages/cli/src/runtime.ts` — register operator actions in the registry
- `packages/cli/src/start.ts` — compose `OperatorManager` into runtime deps

**Pattern** (follow `createCredentialActions` in `packages/sessions/src/actions/`):
```typescript
export function createOperatorActions(deps: {
  operatorManager: OperatorManager;
}): ActionSpec<any, any, SignetError>[] {
  return [
    {
      id: "operator.create",
      intent: "write",
      handler: async (input, ctx) => {
        return deps.operatorManager.create(input);
      },
      input: OperatorConfigSchema,
      cli: { command: "create", group: "operator" },
      mcp: { toolName: "operator_create" },
    },
    // ... list, info, update, remove
  ];
}
```

**Label resolution**: Add a `resolveOperator(idOrLabel)` helper that tries `lookup(id)` first, falls back to scanning `list()` for matching label. Wire into credential.issue validation.

**Tests**:
- All 5 CRUD operations via admin dispatch
- Label resolution: create with label, resolve by label
- `credential.issue` fails when operator doesn't exist

---

### #238 — Policy action surface

**Goal**: Expose policy CRUD and wire into credential service.

**Files to create**:
- `packages/sessions/src/policy-actions.ts` — action spec definitions + handlers

**Files to modify**:
- `packages/sessions/src/index.ts` — export `createPolicyActions`
- `packages/sessions/src/service.ts` — already supports optional `PolicyManager`, verify
- `packages/cli/src/runtime.ts` — register policy actions, pass `PolicyManager` to credential service
- `packages/cli/src/start.ts` — compose `PolicyManager` into runtime deps

**Acceptance test flow**:
```
xs policy create --name watchful-agent --allow messaging:send,messaging:reply --deny access:*
xs cred issue --op alice-bot --policy watchful-agent --chat conv_abc123
# Credential inherits policy permissions
xs cred info cred_xyz  # shows resolved permissions from policy
```

**Also verify**: inline `--allow`/`--deny` still works without `--policy`.

---

### #239 — Message action surface

**Goal**: Full tester-facing message surface (6 actions).

**Files to create**:
- `packages/core/src/message-actions.ts` (or `packages/sessions/src/message-actions.ts` depending on where message logic lives)

**Files to modify**:
- `packages/cli/src/runtime.ts` — register message actions
- `packages/cli/src/start.ts` — wire message action factory

**Key considerations**:
- `message.send` needs the `conv_` → `groupId` resolution from #244
- `message.reply` uses XMTP content type for replies (thread reference)
- `message.react` uses XMTP reaction content type
- `message.read` sends a read receipt content type
- `message.list` returns messages for a `conv_` ID with pagination
- `message.info` returns details for a specific message by `msg_` ID

**Input schemas** (new, define in `packages/schemas/`):
- `MessageSendInput`: `{ chatId: ConversationId, text: string }`
- `MessageReplyInput`: `{ chatId: ConversationId, messageId: MessageId, text: string }`
- `MessageReactInput`: `{ chatId: ConversationId, messageId: MessageId, reaction: string }`
- `MessageReadInput`: `{ chatId: ConversationId, messageId?: MessageId }`
- `MessageListInput`: `{ chatId: ConversationId, limit?: number, before?: string }`
- `MessageInfoInput`: `{ chatId: ConversationId, messageId: MessageId }`

---

### #240 — Invite host wiring

**Goal**: Close the hosted invite join loop in the live runtime.

**Files to modify**:
- `packages/core/src/signet-core.ts` — add `raw.message` listener for DM join requests
- `packages/core/src/conversation-actions.ts` — anchor `inviteTag` in group appData at invite time
- `packages/core/src/convos/process-join-requests.ts` — wire `getGroupInviteTag` to actually verify

**Design**:
1. When `chat.invite` generates an invite, store `inviteTag` in the group's metadata/appData
2. Add a message listener in signet-core that watches for incoming DMs matching the invite slug pattern
3. When a DM join request is detected, route it through `processJoinRequest` with real deps:
   - `getGroupInviteTag` reads from group appData (not a stub)
   - `addMembersToGroup` calls through to the XMTP SDK
4. Emit a `join.processed` event so the runtime can log/audit

**Both scope modes**: ensure invite flows work for per-chat (new inbox per join) and shared (existing inbox adds to group).

**Tests**:
- Full round-trip: generate invite → share slug → process join → verify membership
- Tag verification: join with mismatched tag fails
- Expiry: expired invites are rejected

---

### #241 — Seal InputResolver wiring

**Goal**: Replace the InputResolver stub with a real implementation.

**Files to modify**:
- `packages/cli/src/start.ts:334-340` — replace stub with real resolver
- Possibly extract to `packages/seals/src/resolve-input.ts` for testability

**Implementation**:
```typescript
const resolveInput: InputResolver = async (credentialId, chatId) => {
  // 1. Look up credential record
  const credResult = await credentialManager.lookup(credentialId);
  if (Result.isError(credResult)) return credResult;
  const cred = credResult.value;

  // 2. Look up operator record
  const opResult = await operatorManager.lookup(cred.operatorId);
  if (Result.isError(opResult)) return opResult;
  const op = opResult.value;

  // 3. Build SealInput
  return Result.ok({
    credentialId,
    operatorId: cred.operatorId,
    chatId,
    scopeMode: op.scopeMode,
    permissions: cred.permissions, // resolved ScopeSet
    // Optional fields — defer to later iterations:
    // trustTier, operatorDisclosures, provenanceMap
  });
};
```

**Fail-closed behavior**:
- Add config flag: `config.seals.bypassEnabled` (default: `false`)
- Env override: `SIGNET_SEAL_BYPASS=1`
- In the WS send path, if seal fails and bypass is not active → reject the send
- If bypass is active → send with a `seal_bypassed: true` metadata flag

**Mismatch detection**:
- After building `SealInput`, compare the seal's permissions against the credential's current permissions
- If they diverge (e.g., credential was updated after seal was issued), attach `seal_mismatch: true` + details to the message metadata

**Tests**:
- Real InputResolver produces correct SealInput from credential + operator
- Fail-closed: send without seal fails
- Bypass: send with `SIGNET_SEAL_BYPASS=1` succeeds with metadata flag
- Mismatch: divergent permissions are flagged
- Credential revocation → seal revocation still works

---

### #242 — CLI cutover

**Goal**: Replace all stub CLI groups with action-spec-backed commands.

**Files to modify**:
- `packages/cli/src/commands/xs-operator.ts` — derive from `operator.*` action specs
- `packages/cli/src/commands/xs-chat.ts` — derive from `chat.*` action specs
- `packages/cli/src/commands/xs-message.ts` — derive from `message.*` action specs
- `packages/cli/src/commands/xs-policy.ts` — derive from `policy.*` action specs
- `packages/cli/src/commands/xs-seal.ts` — derive from seal action specs (or document deferral)
- `packages/cli/src/commands/xs-wallet.ts` — document deferral
- `packages/cli/src/commands/xs-key.ts` — `keys.rotate` already exists; wire remaining
- `packages/cli/src/xs-program.ts` — verify all groups are wired

**Pattern** (follow `xs-credential.ts` as reference):
Each `xs-*.ts` module should:
1. Query the action registry for its domain's specs
2. Build Commander commands from `CliSurface` metadata
3. Connect each command to `withDaemonClient` → admin RPC dispatch

**Rename**: `conversation.*` → `chat.*` everywhere (spec IDs, imports, tests).

**Retire**: Old parallel `conversation.ts`, `message.ts` command modules. Remove `stubOutput()` calls.

**Tests**:
- Each CLI group can dispatch through the daemon
- `--help` output matches the intended taxonomy
- No stub commands remain in tester-facing groups

---

### #243 — QA/docs release gate

**Goal**: Real test coverage and aligned docs.

**Files to modify**:
- `packages/cli/src/__tests__/smoke.test.ts` — replace permissive expectations with release-gate assertions
- `packages/cli/src/__tests__/dev-network.test.ts` — update to use current CLI surface
- `README.md` — update CLI examples to shipped taxonomy
- `CLAUDE.md` — update CLI section to match shipped surface
- `docs/` — audit and update architecture/dev docs

**Release-gate test stories**:
1. **Operator lifecycle**: `xs op create` → `xs op list` → `xs op info` → `xs op update` → `xs op rm`
2. **Policy lifecycle**: `xs policy create` → `xs cred issue --policy` → verify permissions resolved
3. **Credential + message flow**: `xs cred issue` → `xs msg send` → `xs msg list` → verify delivery
4. **Invite flow**: `xs chat invite` → requester joins → verify membership
5. **Seal verification**: send message → verify seal attached → verify provenance metadata
6. **Both scope modes**: repeat core flows for per-chat and shared identity

**Docs checklist**:
- [ ] `README.md` uses `xs op`, `xs cred`, `xs chat`, `xs msg`, `xs policy`, `xs seal`
- [ ] `CLAUDE.md` CLI section matches reality
- [ ] All doc examples use `conv_` IDs (not raw `groupId`)
- [ ] Both scope modes documented with examples
- [ ] Architecture docs reference action spec pattern

---

## Cross-Cutting Concerns

### The `conv_` ID Rule

> **`conv_` is the canonical local conversation ID. Raw `groupId` never escapes the core package.**

Every action spec that accepts a conversation reference uses `ConversationId` (`conv_<16hex>`).
Internally, the core package resolves `conv_` → `groupId` via `IdMappingStore` for XMTP SDK calls.
The mapping is created at conversation creation time and is bidirectional.

This affects: #239 (message actions), #241 (seals — `chatId` in `SealInput`), #242 (CLI), #243 (docs/tests).

### Action-Spec Contract Pattern

Every new domain follows the same pattern:
1. Define action specs with `id`, `handler`, `input`, `cli`, `mcp`, `http` fields
2. Export a `create{Domain}Actions(deps)` factory function
3. Register in `packages/cli/src/runtime.ts` via the action registry
4. CLI modules consume from the registry, not bespoke wiring

Reference implementation: `packages/sessions/src/actions/` (credential actions).

### Testing Strategy

Each issue should include:
- **Unit tests**: handler logic in isolation with mock deps
- **Integration tests**: admin dispatch through the running runtime
- **At least one daemon path**: end-to-end through `withDaemonClient`

#243 adds the release-gate tracer bullets that prove the full stack works.

---

## Tester User Stories

These are the end-to-end flows a tester should be able to exercise once #243 closes.

### Story 1: Bootstrap and first message
```bash
xs init                                    # Create dev identity
xs daemon start                            # Start the daemon
xs op create --label alice-bot --role operator --scope per-chat
xs policy create --name chatty --allow messaging:send,messaging:reply
xs cred issue --op alice-bot --policy chatty --chat conv_... 
xs msg send conv_... "Hello from Alice!"
xs msg list conv_...                       # See the message
```

### Story 2: Invite a friend
```bash
xs chat invite conv_... --ttl 3600         # Generate invite URL
# Share URL with another user
# Other user: xs chat join <invite-url>
xs chat member list conv_...               # Both users visible
```

### Story 3: Inspect trust
```bash
xs seal list conv_...                      # See active seals
xs seal info seal_...                      # See permissions, operator, provenance
xs seal verify seal_...                    # Cryptographic verification
```

### Story 4: Shared identity
```bash
xs op create --label research-bot --role operator --scope shared
xs cred issue --op research-bot --allow messaging:send,observation:read-history \
  --chat conv_aaa,conv_bbb
xs msg send conv_aaa "Cross-chat context available"
xs msg send conv_bbb "Same inbox, different chat"
```
