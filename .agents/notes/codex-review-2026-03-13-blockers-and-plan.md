# Codex Review: Blocking Findings And Fix Plan

Date: 2026-03-13
Branch context: current review stack
Scope: capture the review findings, map them to the current code, and give a concrete remediation plan you can work through.

## Summary

The current stack has six blocking issues:

1. A required source file is not included in the submitted patch, so a clean checkout does not build.
2. `BrokerCoreImpl` reuses one identity-bound signer provider for every XMTP client.
3. Shared-identity startup does not register actual group membership, so group-routed operations fail after restart.
4. Startup ignores the result of the initial `syncAll()`, so the broker can report `running` while unsynchronized.
5. Database encryption keys are derived from public material, which breaks the at-rest secrecy requirement.
6. Revoked attestation pairs can be refreshed, which bypasses the revocation guard.

## Findings

### 1. P0: Missing `compute-delta` module in the patch

Files:
- `packages/attestations/src/index.ts`
- `packages/attestations/src/compute-delta.ts`

Current state:
- `index.ts` exports `./compute-delta.js`.
- `compute-delta.ts` exists locally, but it is currently untracked in `git status --short`.

Why this is blocking:
- A fresh checkout or CI run will fail to build `@xmtp-broker/attestations` because the export target is missing from the submitted patch.

Fix plan:
- Add `packages/attestations/src/compute-delta.ts` to the patch/commit.
- Run `bun run build` immediately after staging it so the stack has a valid baseline before touching the runtime fixes.

Verification:
- `bun run build`
- Optional hardening: add a package-level export smoke test only if build coverage is not already enforced in CI.

### 2. P1: One signer provider is reused across all identities

Files:
- `packages/core/src/broker-core.ts`
- `packages/keys/src/signer-provider.ts`

Current state:
- `BrokerCoreImpl.start()` loops through persisted identities.
- Each `clientFactory.create()` call receives `this.#signerProvider`.
- `createSignerProvider(manager, identityId)` produces a provider bound to a single identity.

Why this is blocking:
- The second and later XMTP clients are initialized with the wrong signing key and fingerprint.
- That breaks the per-identity isolation model the broker depends on.

Recommended fix:
- Change `BrokerCoreImpl` to depend on a signer-provider factory instead of a single provider instance.
- During startup, create a fresh provider per identity and pass that provider into `clientFactory.create()`.
- Keep the identity-specific DB encryption lookup on that per-identity provider so the signer and DB key source stay aligned.

Suggested TDD:
- Add a `broker-core` test with two persisted identities.
- Assert that `clientFactory.create()` is called with two distinct providers.
- If practical, assert the providers report different fingerprints or are tagged to different identity IDs in the test double.

Verification:
- `bun test packages/core/src/__tests__/broker-core.test.ts`

### 3. P2: Shared identities are not re-registered with their actual groups

Files:
- `packages/core/src/broker-core.ts`
- `packages/core/src/client-registry.ts`
- `packages/core/src/core-context.ts`
- `packages/core/src/identity-store.ts`

Current state:
- Shared identities persist with `groupId === null`.
- Startup registers them with `groupIds: new Set([])`.
- Group-routed calls such as `sendMessage`, `getGroupInfo`, and `syncGroup` use `registry.getByGroupId()`.

Why this is blocking:
- After restart, the shared client may own many groups, but the runtime registry does not know any of them.
- Any operation routed by group ID can fail with `NotFoundError` even though the XMTP client has the conversation.

Recommended fix:
- After creating the client and after a successful initial sync, call `client.listGroups()`.
- Seed the managed client’s `groupIds` set from the returned group list.
- Treat the runtime registry as the source of truth for active group ownership after startup hydration.

Sanity check while fixing:
- `BrokerCoreContext.getInboxId()` currently routes through `identityStore.getByGroupId()`, which only works for one persisted `group_id`.
- For shared mode, either:
  - switch `getInboxId(groupId)` to resolve through the hydrated runtime registry, or
  - add a durable group-to-identity mapping model.
- The first option is the smaller change if runtime hydration is guaranteed before the context is used.

Suggested TDD:
- Add a shared-mode startup test where `listGroups()` returns one or more groups.
- Assert that `sendMessage`, `getGroupInfo`, and `syncGroup` succeed for those group IDs after `start()`.
- Add a `getInboxId()` regression test if you change that routing path.

Verification:
- `bun test packages/core/src/__tests__/broker-core.test.ts`
- `bun test packages/core/src/__tests__/core-context.test.ts`

### 4. P2: Startup ignores initial sync failures

Files:
- `packages/core/src/broker-core.ts`

Current state:
- `await client.syncAll()` is called.
- The returned `Result` is ignored.
- Startup continues into stream setup, heartbeat startup, and `running` state.

Why this is blocking:
- The broker can announce itself as healthy without completing initial catch-up.
- That breaks the startup recovery guarantees and risks serving requests from stale state.

Recommended fix:
- Capture the `syncAll()` result.
- If it is `Err`, stop startup immediately, set the lifecycle to `error`, and return the sync error.
- Avoid starting streams or heartbeats for a client that failed initial recovery.

Suggested TDD:
- Add a `broker-core` test where `syncAll()` returns `Result.err(...)`.
- Assert:
  - `start()` returns `Err`
  - state ends in `"error"`
  - no `raw.core.started` event is emitted
  - no heartbeat is started

Verification:
- `bun test packages/core/src/__tests__/broker-core.test.ts`

### 5. P1: DB encryption keys are derived from public material

Files:
- `packages/keys/src/signer-provider.ts`
- `packages/keys/src/key-manager.ts`
- `packages/keys/src/root-key.ts`

Current state:
- `deriveDbEncryptionKey()` imports the operational public key into HKDF.
- `identityId` is used as context info.
- Both inputs are non-secret or easily discoverable.

Why this is blocking:
- Anyone with the public key and identity ID can reproduce the same DB key.
- That defeats the secrecy claim for XMTP DB and vault encryption at rest.

Recommended fix:
- Replace the public-key HKDF path with a secret-backed mechanism.
- Preferred implementation: store a random 32-byte per-identity DB key in the vault and return it deterministically across restarts.
- Alternative if you want true derivation: derive from secret vault/root material without exposing that secret through the public provider surface.

Why the vault-backed random key is a good fit:
- It preserves determinism across restarts.
- It avoids widening access to the root private key.
- It keeps the change local to key management instead of spreading root-key material through the runtime.

Suggested TDD:
- Update `signer-provider.test.ts` to keep the existing determinism checks.
- Add a regression assertion that the DB key is no longer computable from `publicKey + identityId`.
- If you add a vault-backed API on `KeyManager`, test that deleting the stored DB key causes regeneration or fails loudly, depending on the policy you choose.

Verification:
- `bun test packages/keys/src/__tests__/signer-provider.test.ts`
- `bun test packages/keys/src/__tests__/key-manager.test.ts`

### 6. P1: Revoked attestation pairs can still be refreshed

Files:
- `packages/attestations/src/manager.ts`

Current state:
- `revoke()` adds the agent+group chain key to `revokedPairs`.
- `issue()` checks `revokedPairs`.
- `refresh()` does not.

Why this is blocking:
- A revoked agent/group pair can mint a fresh attestation via `refresh(attestationId)`.
- That bypasses the intended terminal revocation guard.

Recommended fix:
- In `refresh()`, rebuild the same chain key and reject if it is present in `revokedPairs`.
- Keep the error consistent with `issue()` so callers see the same revoked-pair behavior regardless of entry point.

Suggested TDD:
- Add a manager test that:
  - issues an attestation
  - revokes it
  - attempts `refresh(originalAttestationId)`
  - expects `Err`
- Confirm no new publish occurs after the rejected refresh.

Verification:
- `bun test packages/attestations/src/__tests__/manager.test.ts`

## Execution Plan

Recommended order:

1. Restore a clean build baseline.
   - Stage and commit `packages/attestations/src/compute-delta.ts`.
   - Run `bun run build`.

2. Fix `BrokerCoreImpl` identity isolation first.
   - Introduce a per-identity signer-provider creation path.
   - Add the multi-identity regression test.

3. Fix startup correctness in the same package while the core tests are open.
   - Fail fast on `syncAll()` errors.
   - Hydrate shared-mode group membership from `listGroups()`.
   - Decide whether `getInboxId()` should route through registry for shared mode.

4. Fix DB-key secrecy in the keys package.
   - Replace public-key HKDF with a vault-secret-backed key source.
   - Keep restart determinism and identity isolation tests green.

5. Close the revocation bypass in the attestations package.
   - Add the refresh-after-revoke regression test.
   - Make `refresh()` enforce the terminal revocation rule.

6. Run focused verification, then full verification.
   - Focused package tests first.
   - Then `bun run test`, `bun run typecheck`, and `bun run build`.

## TDD Checklist

The repo guidance is explicit about red-green-refactor. A clean way to work through this is:

1. Add or update the failing test for one issue.
2. Make the smallest code change that turns the test green.
3. Refactor while keeping the package green.
4. Move to the next issue.

Suggested test additions:
- `packages/core/src/__tests__/broker-core.test.ts`
  - multiple identities get distinct signer providers
  - startup fails when `syncAll()` fails
  - shared-mode groups are hydrated from `listGroups()`
- `packages/core/src/__tests__/core-context.test.ts`
  - shared-mode group routing still works after startup
- `packages/keys/src/__tests__/signer-provider.test.ts`
  - DB key remains stable per identity across restarts
  - DB key source is secret-backed rather than public-data-derived
- `packages/attestations/src/__tests__/manager.test.ts`
  - refresh is rejected after revoke

## Final Verification Gate

Before considering the stack fixed:

- `git status --short` should not show required source files as untracked.
- `bun run build`
- `bun run test`
- `bun run typecheck`

If you want, the next step can be turning this note into a checklist-driven implementation pass one issue at a time.
