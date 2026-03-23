# v1 Phases 2-7 Execution Plan — Full Stack Continuation

**Version:** 1.0
**Created:** 2026-03-23
**Status:** Ready to execute
**Prerequisite:** Phase 1 complete (PRs #132-140), on `v1/phase1-tests` branch

## Overview

Phase 1 replaced v0 schemas with v1 equivalents, intentionally breaking all downstream packages. Phases 2-7 fix those packages and implement the v1 runtime, seal protocol, CLI, and tests — all in one continuous Graphite stack.

**28 new PRs (Steps 10-37) continuing from Phase 1's 9 PRs = 37 total.**

## Stack

```text
v1/phase1-tests (#140)
  └── v1/policy-rewrite         Phase 2: Fix Downstream (Steps 10-17)
       └── v1/keys-update
            └── v1/sessions-to-creds
                 └── v1/seals-update
                      └── v1/ws-update
                           └── v1/mcp-update
                                └── v1/sdk-update
                                     └── v1/cli-update
                                          └── v1/key-backend-interface   Phase 3: Keys (Steps 18-21)
                                               └── v1/bip39-derivation
                                                    └── v1/internal-vault
                                                         └── v1/key-manager-rewrite
                                                              └── v1/operator-manager   Phase 4: Identity (Steps 22-26)
                                                                   └── v1/policy-manager
                                                                        └── v1/credential-manager
                                                                             └── v1/scope-guard
                                                                                  └── v1/identity-tests
                                                                                       └── v1/seal-chaining   Phase 5: Seals (Steps 27-29)
                                                                                            └── v1/message-seal-binding
                                                                                                 └── v1/seal-auto-republish
                                                                                                      └── v1/xs-binary   Phase 6: CLI (Steps 30-33)
                                                                                                           └── v1/xs-operator-cred
                                                                                                                └── v1/xs-chat-msg
                                                                                                                     └── v1/xs-policy-seal
                                                                                                                          └── v1/full-build-fix   Phase 7: Integration (Steps 34-37)
                                                                                                                               └── v1/security-tests
                                                                                                                                    └── v1/tracer-bullet
                                                                                                                                         └── v1/docs-update
```

## Agent Roles & Rules

Same as Phase 1:
- **Orchestrator** runs ALL gt/git commands
- **Implementer** subagents write code only — NO git
- **Reviewer** subagents at phase boundaries (Steps 12, 17, 21, 26, 29, 33, 37)
- `--no-verify` on submit until Step 34
- One commit per branch, one branch per PR

---

## Phase 2: Fix Downstream + Policy Rewrite (Steps 10-17)

### Step 10: Policy Rewrite (`v1/policy-rewrite`) ~400 LOC
**Scope:** `packages/policy/`

Replace ViewConfig/GrantConfig-based validators with scope-based system:
- ALL grant validators → accept `ScopeSetType` + `chatIds` instead of `GrantConfig` + `ViewConfig`
- `scope-check.ts` → check chatId against credential's chatIds array
- `project-message.ts` → use `read-messages`/`read-history` scopes for visibility
- `materiality.ts` → compare ScopeSet diffs
- Delete content-projector.ts if v0-dependent
- Update all policy tests

**Commit:** `feat(policy): rewrite grant validators for scope-based permission system`

### Step 11: Keys Update (`v1/keys-update`) ~100 LOC
**Scope:** `packages/keys/`

- Update `seal-stamper.ts` → `SealPayloadType` + `SealEnvelopeType`
- Update `signer-provider.ts` if needed

**Commit:** `fix(keys): update seal stamper for v1 seal types`

### Step 12: Sessions → Credentials (`v1/sessions-to-creds`) ~500 LOC
**Scope:** `packages/sessions/`

Heavy rewrite:
- `InternalSessionRecord` → `InternalCredentialRecord` (operatorId, credentialId, effectiveScopes, chatIds, status)
- `createSession()` → `issueCredential()` with `CredentialConfigType`
- `revokeSession()` → `revokeCredential()` with `CredentialRevocationReason`
- `policy-hash.ts` → hash scope set
- `materiality.ts` → compare scope sets
- `actions.ts` → credential.issue/list/lookup/revoke
- Update token.ts, service.ts, reveal-actions, update-actions, pending-actions

**Commit:** `feat(sessions): rewrite session manager as credential manager`
**Review checkpoint** after this step.

### Step 13: Seals Update (`v1/seals-update`) ~300 LOC
**Scope:** `packages/seals/`

- Rewrite `build.ts` → construct SealPayload from credential + scopes
- Remove `grant-ops.ts`
- Update manager.ts → SealChain, SealEnvelope
- Update publisher.ts, content-type.ts

**Commit:** `feat(seals): update seal build and manager for v1 credential-based seals`

### Step 14: WS Update (`v1/ws-update`) ~200 LOC
**Scope:** `packages/ws/`

- `frames.ts` → CredentialTokenType, ScopeSetType
- `auth-handler.ts` → CredentialRecord
- `server.ts` → credential broadcast
- Update tests

**Commit:** `fix(ws): update frames and auth for v1 credential types`

### Step 15: MCP Update (`v1/mcp-update`) ~150 LOC
**Scope:** `packages/mcp/`

- SessionRecord → CredentialRecord everywhere
- session-guard → credential guard
- Update fixtures

**Commit:** `fix(mcp): update MCP server for v1 credential types`

### Step 16: SDK Update (`v1/sdk-update`) ~100 LOC
**Scope:** `packages/sdk/`

- Update v1 event/request type imports
- Minimal changes

**Commit:** `fix(sdk): update SDK for v1 event and request types`

### Step 17: CLI Update (`v1/cli-update`) ~400 LOC
**Scope:** `packages/cli/`

- commands/session.ts → commands/credential.ts
- commands/grant.ts → scope-based
- admin/dispatcher.ts → credential.* routing
- ws/request-handler.ts, event-projector.ts → credential refs
- http/server.ts, runtime.ts, start.ts, config/schema.ts
- Update all CLI test fixtures

**Commit:** `feat(cli): update commands and admin dispatcher for v1 credential model`
**Review checkpoint** after this step.

---

## Phase 3: Key Management Redesign (Steps 18-21)

### Step 18: KeyBackend Interface (`v1/key-backend-interface`) ~150 LOC
**Scope:** `packages/keys/`

New `key-backend.ts`:
- `KeyBackend` interface: createWallet, deleteWallet, deriveAccount, sign, createApiKey, revokeApiKey
- `WalletInfo`, `AccountInfo`, `SigningResult` types

**Commit:** `feat(keys): KeyBackend provider-agnostic interface`

### Step 19: BIP-39/44 Derivation (`v1/bip39-derivation`) ~250 LOC
**Scope:** `packages/keys/`

New `derivation.ts`:
- BIP-39 mnemonic generation (24 words, 256-bit entropy)
- BIP-44 path derivation (secp256k1 for EVM/XMTP, Ed25519 for seals)
- `generateMnemonic()`, `mnemonicToSeed()`, `derivePath()`

**Commit:** `feat(keys): BIP-39 mnemonic generation and BIP-44 key derivation`

### Step 20: Internal Vault Rewrite (`v1/internal-vault`) ~300 LOC
**Scope:** `packages/keys/`

Rewrite `vault.ts`:
- OWS-compatible Keystore v3 format (scrypt + AES-256-GCM)
- One wallet file per operator
- API key files (HKDF-SHA256 + AES-256-GCM)
- Storage at `~/.xmtp/signet/wallets/` and `~/.xmtp/signet/keys/`

**Commit:** `feat(keys): OWS-compatible encrypted vault with Keystore v3 format`

### Step 21: Key Manager Rewrite (`v1/key-manager-rewrite`) ~250 LOC
**Scope:** `packages/keys/`

Rewrite `key-manager.ts`:
- Uses KeyBackend interface
- One wallet per operator (BIP-39)
- Account derivation per inbox (BIP-44 index)
- Credential token creation via HKDF
- Updated biometric-gate.ts, config.ts

**Commit:** `feat(keys): rewrite key manager with KeyBackend and per-operator wallets`
**Review checkpoint** after this step.

---

## Phase 4: Identity Runtime (Steps 22-26)

### Step 22: Operator Manager (`v1/operator-manager`) ~200 LOC
**Scope:** `packages/sessions/`

OperatorManager implementation: create, list, lookup, update, remove with role hierarchy enforcement.

**Commit:** `feat(sessions): implement operator manager with role hierarchy`

### Step 23: Policy Manager (`v1/policy-manager`) ~150 LOC
**Scope:** `packages/sessions/`

PolicyManager implementation: CRUD with action registry wiring.

**Commit:** `feat(sessions): implement policy manager`

### Step 24: Credential Manager (`v1/credential-manager`) ~300 LOC
**Scope:** `packages/sessions/`

CredentialManager implementation: issue with scope resolution, token generation, renewal, expiry sweep, heartbeat.

**Commit:** `feat(sessions): implement credential manager with scope resolution`

### Step 25: Scope Guard (`v1/scope-guard`) ~150 LOC
**Scope:** `packages/policy/`

ScopeGuard implementation: check scope against credential, resolve effective scopes.

**Commit:** `feat(policy): implement scope guard for credential-based enforcement`

### Step 26: Identity Runtime Tests (`v1/identity-tests`) ~300 LOC

Tests for all Phase 4 managers + scope guard.

**Commit:** `test(sessions): operator, policy, and credential manager tests`
**Review checkpoint** after this step.

---

## Phase 5: Seal Protocol v2 (Steps 27-29)

### Step 27: Seal Chaining (`v1/seal-chaining`) ~200 LOC
- SealChain construction with inline previous + delta computation
- Chain validation

**Commit:** `feat(seals): seal chaining with inline previous payload and delta computation`

### Step 28: Message Seal Binding (`v1/message-seal-binding`) ~150 LOC
- Sign(messageId + sealId) with credential key
- Verification pipeline

**Commit:** `feat(seals): message-seal binding with credential key signatures`

### Step 29: Auto-Republish (`v1/seal-auto-republish`) ~150 LOC
- Republish on credential mutation with retry
- Seal tests

**Commit:** `feat(seals): automatic seal republish on credential mutation`
**Review checkpoint** after this step.

---

## Phase 6: CLI Restructure (Steps 30-33)

### Step 30: `xs` Binary (`v1/xs-binary`) ~200 LOC
- Rename entry point, top-level commands

**Commit:** `feat(cli): xs binary with top-level commands`

### Step 31: Operator + Credential Commands (`v1/xs-operator-cred`) ~300 LOC

**Commit:** `feat(cli): operator and credential commands for xs`

### Step 32: Chat + Message Commands (`v1/xs-chat-msg`) ~200 LOC

**Commit:** `feat(cli): chat and message commands for xs`

### Step 33: Policy + Seal + Utility Commands (`v1/xs-policy-seal`) ~200 LOC

**Commit:** `feat(cli): policy, seal, wallet, key, and utility commands for xs`
**Review checkpoint** after this step.

---

## Phase 7: Integration + Security (Steps 34-37)

### Step 34: Full Build Fix (`v1/full-build-fix`) ~200 LOC
- Fix ALL remaining compilation errors
- `bun run build` + `bun run typecheck` + `bun run lint` must pass

**Commit:** `fix: resolve all remaining v1 compilation errors across packages`

### Step 35: Security Boundary Tests (`v1/security-tests`) ~400 LOC
- Role isolation, message access, credential scope, deny-wins, expiry

**Commit:** `test: security boundary tests for role isolation and credential scoping`

### Step 36: End-to-End Tracer (`v1/tracer-bullet`) ~300 LOC
- Full lifecycle + scope enforcement + revocation

**Commit:** `test(integration): v1 end-to-end tracer bullet`

### Step 37: Documentation Update (`v1/docs-update`) ~200 LOC
- CLAUDE.md, architecture docs, dev guides

**Commit:** `docs: update documentation for v1 architecture`
**Final review checkpoint.**

---

## Step Summary

| Step | Branch | Phase | ~LOC |
|------|--------|-------|------|
| 10 | v1/policy-rewrite | 2 | 400 |
| 11 | v1/keys-update | 2 | 100 |
| 12 | v1/sessions-to-creds | 2 | 500 |
| 13 | v1/seals-update | 2 | 300 |
| 14 | v1/ws-update | 2 | 200 |
| 15 | v1/mcp-update | 2 | 150 |
| 16 | v1/sdk-update | 2 | 100 |
| 17 | v1/cli-update | 2 | 400 |
| 18 | v1/key-backend-interface | 3 | 150 |
| 19 | v1/bip39-derivation | 3 | 250 |
| 20 | v1/internal-vault | 3 | 300 |
| 21 | v1/key-manager-rewrite | 3 | 250 |
| 22 | v1/operator-manager | 4 | 200 |
| 23 | v1/policy-manager | 4 | 150 |
| 24 | v1/credential-manager | 4 | 300 |
| 25 | v1/scope-guard | 4 | 150 |
| 26 | v1/identity-tests | 4 | 300 |
| 27 | v1/seal-chaining | 5 | 200 |
| 28 | v1/message-seal-binding | 5 | 150 |
| 29 | v1/seal-auto-republish | 5 | 150 |
| 30 | v1/xs-binary | 6 | 200 |
| 31 | v1/xs-operator-cred | 6 | 300 |
| 32 | v1/xs-chat-msg | 6 | 200 |
| 33 | v1/xs-policy-seal | 6 | 200 |
| 34 | v1/full-build-fix | 7 | 200 |
| 35 | v1/security-tests | 7 | 400 |
| 36 | v1/tracer-bullet | 7 | 300 |
| 37 | v1/docs-update | 7 | 200 |

**28 PRs, ~6300 LOC total.**
