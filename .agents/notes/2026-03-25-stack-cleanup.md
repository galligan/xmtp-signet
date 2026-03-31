# Stack Cleanup Notes

## 2026-03-25

- `v1/contracts-update` no longer fails on session/credential cutover drift.
- Cherry-picked credential/session cutover commits onto `v1/contracts-update`:
  - `3b84cf59` -> `2624ddb0`
  - `07063a91` -> `93b9b0a0`
  - `3569ed35` -> `515e6097`
  - `3e17ad34` -> `f0f94f42`
- Fixed `CredentialConfig.ttlSeconds` to remain optional at the schema boundary.
- Updated schema test to reflect runtime defaulting instead of schema defaulting.
- Current `v1/contracts-update` full-check boundary now falls through to expected downstream policy drift:
  - `packages/policy` still imports removed `ViewConfig` / `GrantConfig` / `ViewMode` surfaces.
- `v1/permission-scopes` had a real local export bug:
  - `packages/schemas/src/index.ts` stopped exporting `ViewConfig` / `GrantConfig`
    even though `packages/contracts/src/session-types.ts` still depended on them.
  - Fixed on `v1/permission-scopes` in commit `286aa3f6`.
  - Branch is green after `bun run check`.
- `v1/policy-schema` had a real local `isolatedDeclarations` failure:
  - `packages/schemas/src/policy.ts` exported `PolicyConfig` / `PolicyRecord`
    without explicit annotations, and docs coverage also needed variable-level docs.
  - Fixed on `v1/policy-schema` in commit `945974f8`.
  - Branch is green after `bun run check`.
- Bulk stack sweeps can produce transient false reds on later branches.
  - Most notable case: `v1/docs-update` briefly failed in `packages/sessions`
    with ENOENT on test files during a branch-hopping sweep, but isolated reruns
    on the branch passed.
  - Treat isolated per-branch reruns as the authoritative signal.
- `v1/credential-schema` had two real local regressions:
  - `packages/schemas/src/session.ts` had been removed even though this historical
    cut still used session-based events, requests, and downstream contracts.
    Restored `session.ts` and re-exported its public types from
    `packages/schemas/src/index.ts`.
  - `packages/schemas/src/credential.ts` still required `issuedBy: OperatorId`
    even though the branch's tests and docs already allowed `owner | operator`,
    and it also needed explicit exported schema annotations for
    `isolatedDeclarations`.
  - Branch is green after `bun run check`.
- `v1/phase1-tests` had two real local inconsistencies before the expected
  later-phase seal drift:
  - `packages/contracts`, `packages/policy`, and `packages/sessions` disagreed
    about policy delta shape and error unions. Fixed by bridging the legacy
    scope-delta path and the newer structured delta path so the branch-local
    materiality logic remains self-consistent.
  - `packages/keys` still used stale trust-tier imports, raw UUID key IDs, and
    the old seal envelope shape. Fixed by moving keys to local trust-tier typing,
    prefixed `key_` resource IDs, and current chain-based seal envelopes.
  - Focused checks now pass for `packages/contracts`, `packages/policy`,
    `packages/sessions`, and `packages/keys`.
  - Full `bun run check` now falls through to expected later-phase `packages/seals`
    drift (`SealSchema` / `SealEnvelopeSchema` import mismatches), so the
    branch-local bugs appear cleared.
- `v1/policy-rewrite` currently clears its own package boundary.
  - `bun run check` falls through to expected downstream `packages/mcp`
    session/credential drift:
    - missing `SessionManager` / `SessionRecord` exports from contracts
    - `HandlerContext` no longer accepting `sessionId`
  - No new `policy`-local or `keys`-local regressions surfaced on this cut.
- `v1/sessions-to-creds` had a real local MCP cutover bug:
  - `packages/mcp` still treated callers as sessions even though the branch's
    contracts and handler context had moved to credentials.
  - Fixed by switching MCP auth/liveness and handler context over to
    `CredentialRecord` / `credentialId`, replacing the session guard with a
    credential guard, and updating MCP fixtures/tests to use credential-native
    records and lookups.
  - `cd packages/mcp && bun run lint && bun run typecheck && bun test` passes.
  - Full `bun run check` now falls through to expected downstream
    `packages/seals` drift:
    - stale imports of `SealEnvelopeSchema` from contracts
    - the older seal package model is still present on this cut and should be
      addressed where the seals rewrite lands

## v1/seals-update
- packages/seals is locally green; failures on this cut are forward references in CLI/integration (later branches own them).

## v1/mcp-update
- packages/mcp is locally green after credential cutover; failures on this cut are later CLI/integration drift.

## v1/cli-update
- `bun run check` passes on this branch. CLI/runtime and integration surfaces are coherent here after earlier lower-stack fixes.

## v1/internal-vault
- packages/keys was branch-locally broken: the vault refactor dropped generic set/get/delete/list secret storage while the old key-manager/admin/root/operational code still depended on it.
- Fixed by restoring opaque secret storage on the new vault (memory + file-backed) and adding direct vault coverage.
- `bun run check` now passes on this branch.

## v1/key-backend-interface..v1/docs-update
- After the internal-vault fix, every branch from `v1/key-backend-interface` up through `v1/docs-update` passed `bun run check` in order.

## v1/docs-agents-alignment
- Top branch had stale schemas drift: deleted `view.ts` / `grant.ts` but still exported them from `packages/schemas/src/index.ts`, and stale `session.ts` still imported those deleted modules.
- Removed the dead session/view/grant schema surface; `bun run check` now passes on the true top branch.
- Committed on `v1/docs-agents-alignment` as `8efc0762` (`fix(schemas): drop stale session schema exports`).
- User confirmed this is a full cutover, so future cleanup should prefer removing legacy compatibility surfaces rather than preserving old session/view/grant naming.

## Fresh branch sweep
- Fresh bottom-up sweep across `v1/*` with branch-hopping showed many apparent reds, but two of the scary ones were stale build-artifact failures rather than source bugs:
  - `v1/policy-schema` goes green after rebuilding `packages/schemas`.
  - `v1/credential-manager` goes green after rebuilding `packages/schemas`.
- The first confirmed source-level branch-local failure was `v1/contracts-update`:
  - `packages/contracts/src/policy-types.ts` defined `PolicyDelta` as scope-set `added/removed/changed`, but `packages/policy/src/materiality.ts` and its tests still implemented the old structured `viewChanges/grantChanges/contentTypeChanges` model.
  - `GrantError` also excluded `GrantDeniedError` even though the grant validators returned it directly.
  - Fixed on `v1/contracts-update` in commit `350aea1d` (`fix(policy): align materiality with scope deltas`).
  - After the fix, `v1/contracts-update` falls through to later `packages/keys` type drift rather than failing in its own policy/contracts slice.

## 2026-03-25 cutover cleanup batch
- Treating the repo as a true v1 cutover now: no backwards-compat shims are protected.
- Current verified cleanup batch on `v1/docs-agents-alignment`:
  - Simplified `PolicyDelta` to the single scope-set shape the runtime actually uses.
    - Removed `LegacyPolicyDelta` / `StructuredPolicyDelta` from `packages/contracts`.
    - Dropped the cutover-era structured delta handling from
      `packages/policy/src/materiality.ts`.
    - Updated `packages/sessions/src/materiality.ts` to emit the single
      `PolicyDelta` contract directly.
  - Renamed the SDK's public authenticated state from `session` /
    `SessionInfo` to `credential` / `CredentialInfo`.
  - Removed the `session.` method alias from the HTTP credential route and
    added a regression test that `POST /v1/credential/session.info` is rejected.
  - Removed stale `session-expired` fallback mapping from CLI seal revocation
    routing.
- Focused verification:
  - `bun test packages/policy/src/__tests__/materiality.test.ts packages/sdk/src/__tests__/handler.test.ts packages/cli/src/__tests__/http-server.test.ts`
  - `bun run typecheck --filter @xmtp/signet-contracts --filter @xmtp/signet-policy --filter @xmtp/signet-sessions --filter @xmtp/signet-sdk --filter @xmtp/signet-cli`

## 2026-03-25 grant-error cleanup
- Removed the dead `GrantDeniedError` / `GrantError` compatibility surface from the live top branch:
  - deleted `GrantDeniedError` from `packages/schemas`
  - removed it from `AnySignetError`, public exports, and admin-client reconstruction
  - simplified contract/integration tests to treat permission denials as plain `PermissionError`
  - updated one stale `NotFoundError` test fixture from `Session` to `Credential`
- Verified with:
  - `bun test packages/schemas/src/__tests__/errors.test.ts packages/integration/src/__tests__/contract-verification.test.ts`
  - `bun run typecheck --filter @xmtp/signet-schemas --filter @xmtp/signet-contracts --filter @xmtp/signet-cli --filter @xmtp/signet-integration`
  - full top-of-stack `bun run check`
- `gt absorb -a` can confidently place the contract-side deletions, but the broader schema/admin-client/test removals are still staying together as a top-branch cleanup batch for now because Graphite is reporting stack SHA drift during forced absorb.

## 2026-03-25 terminology cleanup batch
- Treating top-of-stack cleanup as true cutover debt removal rather than compatibility preservation.
- Current uncommitted batch on `v1/docs-agents-alignment`:
  - `packages/keys`
    - Renamed compat `SessionKey` surface to `CredentialKey`.
    - Renamed compat methods to `issueCredentialKey`, `revokeCredentialKey`, and `signWithCredentialKey`.
    - Removed dead `sessionKeyTtlSeconds` from key manager config.
    - Renamed biometric gate operations from `viewUpgrade` / `grantEscalation` to `scopeExpansion` / `egressExpansion`.
  - `packages/cli`
    - Renamed config block from `sessions` to `credentials`.
    - Renamed `maxConcurrentPerAgent` to `maxConcurrentPerOperator`.
    - Removed dead `heartbeatIntervalSeconds` CLI config.
    - Updated HTTP/admin integration fixtures from `sessions` payloads to `credentials` payloads where they model credential actions.
  - `packages/sdk`
    - Renamed token description from "Session bearer token" to "Credential bearer token".
  - `packages/ws`
    - Renamed close code labels from `SESSION_EXPIRED` / `SESSION_REVOKED` to `CREDENTIAL_EXPIRED` / `CREDENTIAL_REVOKED`.
    - Updated server call sites and close-code tests.
  - comment/docs cleanup in runtime code:
    - removed stale `session` / `view` wording from contracts, policy, CLI audit log, WS registry/replay buffer, and event projector comments.
- Focused verification:
  - `bun test packages/keys/src/__tests__/config.test.ts packages/keys/src/__tests__/biometric-gate.test.ts packages/integration/src/__tests__/key-hierarchy.test.ts packages/cli/src/__tests__/config-schema.test.ts packages/cli/src/__tests__/config-loader.test.ts packages/cli/src/__tests__/runtime.test.ts packages/cli/src/__tests__/network-startup.test.ts`
  - `bun test packages/cli/src/__tests__/admin-dispatcher.test.ts packages/cli/src/__tests__/http-api-integration.test.ts packages/cli/src/__tests__/http-server.test.ts packages/ws/src/__tests__/close-codes.test.ts`
  - `bun run typecheck --filter @xmtp/signet-keys --filter @xmtp/signet-cli --filter @xmtp/signet-integration`
  - `bun run typecheck --filter @xmtp/signet-sdk --filter @xmtp/signet-ws --filter @xmtp/signet-cli`
- Next step: restack and re-run full top-of-stack `bun run check`, then absorb downstack where Graphite can place deterministic renames cleanly.

## 2026-03-25 reliability + test-surface cleanup
- New cleanup landed and top-of-stack `bun run check` stayed green after restack:
  - `packages/keys`
    - Live Secure Enclave integration tests are now opt-in via
      `SIGNET_RUN_LIVE_SE_TESTS=1`, so the default required check no longer
      depends on local hardware/session state.
  - `packages/cli`
    - HTTP server and HTTP API integration tests now use port `0` and the
      bound port returned by the server instead of guessing random ports.
    - Smoke test now binds WebSocket on port `0` and connects using the daemon's
      reported `wsPort`, removing another random-port collision point.
    - Audit-log generic fixtures now use `credential.*` targets instead of
      stale `session.*` / `grant.*` action examples.
  - `packages/contracts`
    - Action registry fixtures now use `credential.*` action IDs instead of
      `session.*` examples.
  - `packages/schemas` / `packages/contracts`
    - Minor comment/doc wording updated from sessions -> credentials in
      `operator.ts`, `policy.ts`, and `handler-types.ts`.
- Focused verification:
  - `bun test packages/keys/src/__tests__/se-test-capability.ts packages/keys/src/__tests__/se-integration.test.ts packages/keys/src/__tests__/se-bridge.test.ts`
  - `bun test packages/cli/src/__tests__/http-server.test.ts packages/cli/src/__tests__/http-api-integration.test.ts`
  - `bun test packages/cli/src/__tests__/smoke.test.ts packages/contracts/src/__tests__/action-registry.test.ts packages/cli/src/__tests__/audit-log.test.ts`
  - full top-of-stack `bun run check`

## 2026-03-25 verifier + reveal + skill cleanup
- `v1/security-tests`
  - `packages/verifier` self-seals are now signed and advertise the
    `source-verified` capability instead of the old placeholder behavior.
  - Commit: `8ef0c2ac` (`fix(verifier): sign self-seal capabilities`)
  - Verified:
    - `bun test packages/verifier/src/__tests__/service.test.ts packages/verifier/src/__tests__/verdict.test.ts packages/verifier/src/__tests__/source-available.test.ts`
    - `bun run typecheck --filter @xmtp/signet-verifier`
- `v1/full-build-fix`
  - Removed dead mock type aliases and unused fixture imports from
    `packages/core/src/__tests__/sdk-fixtures.ts`.
  - Commits: `7ee233b2`, `2b5529e7`
  - Verified:
    - `bun test packages/core/src/__tests__/sdk-client.test.ts packages/core/src/__tests__/sdk-stream-wrappers.test.ts packages/core/src/__tests__/sdk-type-mapping.test.ts packages/core/src/__tests__/list-messages.test.ts`
- `v1/full-build-fix`
  - Finished the reveal cutover from `RevealGrant` / `.grant()` to
    `RevealAccess` / `.record()` across CLI, contracts, policy, schemas,
    sessions, and verifier coverage.
  - Commit: `51988805` (`refactor: finish reveal access cutover`)
  - `gt absorb -a -f` automatically placed smaller deterministic hunks onto
    `v1/cli-update`, `v1/contracts-update`, `v1/seal-auto-republish`, and
    `v1/full-build-fix` before the remaining coherent diff was committed.
  - Verified:
    - `bun test packages/schemas/src/__tests__/reveal.test.ts packages/schemas/src/__tests__/events.test.ts packages/policy/src/__tests__/reveal-state.test.ts packages/sessions/src/__tests__/reveal-actions.test.ts packages/sessions/src/__tests__/reveal-state.test.ts packages/cli/src/__tests__/reveal-mode.test.ts packages/cli/src/__tests__/event-projector.test.ts packages/cli/src/__tests__/redacted-pipeline-e2e.test.ts packages/cli/src/__tests__/action-confirm-integration.test.ts packages/cli/src/__tests__/ws-request-handler.test.ts packages/verifier/src/__tests__/release-signing.test.ts`
- `v1/docs-agents-alignment`
  - Updated active `.claude` skill surfaces to stop teaching v0
    `session` / `grant` workflows:
    - `.claude/skills/tracer-bullet/SKILL.md`
    - `.claude/skills/xmtp-signet-dev/SKILL.md`
    - `.claude/skills/xmtp-signet-use/SKILL.md`
    - `.claude/skills/xmtp-signet-dev/references/architecture.md`
    - `.claude/skills/xmtp-signet-dev/references/key-hierarchy.md`
    - `.claude/skills/xmtp-signet-dev/references/packages.md`
    - `.claude/skills/xmtp-signet-use/references/content-types.md`
    - `.claude/skills/xmtp-signet-use/references/trust-model.md`
  - Remaining live `.claude` surfaces no longer reference `xs session`,
    `xs grant`, `session token`, `RevealGrant`, or `GrantDeniedError`.
