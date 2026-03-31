---
created: 2026-03-25T00:00:00-04:00
type: working-note
status: active
---

# V1 Stack Cleanup Tracker

Temporary internal tracker for the pre-ready cleanup pass across the `v1/*`
Graphite stack.

## Goals

- Keep `v1/docs-agents-alignment` green after every cleanup.
- Burn down real bug debt and stale compat assumptions before moving PRs out of
  draft.
- Distinguish intentionally partial historical branches from accidental
  regressions that deserve fixes.

## Ground Rules

- Land fixes on the earliest branch that introduces the bug.
- Restack immediately after each fix.
- Re-run `bun run check` on the top branch after each restack.
- Avoid touching user-owned scratch notes, especially:
  - `.trail/notes/2026-03-23/handoff-v1-complete.md`

## Completed

- `v1/security-tests`
  - Signed verifier self-seals and removed the stale placeholder capability
    behavior in
    `packages/verifier/src/service.ts`
    `packages/verifier/src/__tests__/service.test.ts`
    `packages/verifier/src/verdict.ts`
    `packages/verifier/src/checks/source-available.ts`
  - Commit: `8ef0c2ac`
  - Verified:
    - `bun test packages/verifier/src/__tests__/service.test.ts packages/verifier/src/__tests__/verdict.test.ts packages/verifier/src/__tests__/source-available.test.ts`
    - `bun run typecheck --filter @xmtp/signet-verifier`
- `v1/full-build-fix`
  - Removed dead core fixture aliasing and unused imports in
    `packages/core/src/__tests__/sdk-fixtures.ts`
  - Commits: `7ee233b2`, `2b5529e7`
  - Verified:
    - `bun test packages/core/src/__tests__/sdk-client.test.ts packages/core/src/__tests__/sdk-stream-wrappers.test.ts packages/core/src/__tests__/sdk-type-mapping.test.ts packages/core/src/__tests__/list-messages.test.ts`
- `v1/full-build-fix`
  - Finished the reveal access cutover by replacing `RevealGrant` /
    store `.grant()` semantics with `RevealAccess` / `.record()` across
    CLI, contracts, policy, schemas, sessions, and verifier coverage
  - Commit: `51988805`
  - Verified:
    - `bun test packages/schemas/src/__tests__/reveal.test.ts packages/schemas/src/__tests__/events.test.ts packages/policy/src/__tests__/reveal-state.test.ts packages/sessions/src/__tests__/reveal-actions.test.ts packages/sessions/src/__tests__/reveal-state.test.ts packages/cli/src/__tests__/reveal-mode.test.ts packages/cli/src/__tests__/event-projector.test.ts packages/cli/src/__tests__/redacted-pipeline-e2e.test.ts packages/cli/src/__tests__/action-confirm-integration.test.ts packages/cli/src/__tests__/ws-request-handler.test.ts packages/verifier/src/__tests__/release-signing.test.ts`
  - `gt absorb -a -f` also auto-placed smaller hunks on
    `v1/cli-update`, `v1/contracts-update`, and `v1/seal-auto-republish`
- `v1/docs-agents-alignment`
  - Cleaned up active `.claude` skill guidance so future agent runs stop
    teaching `xs session` / `xs grant` flows
  - Updated:
    `.claude/skills/tracer-bullet/SKILL.md`
    `.claude/skills/xmtp-signet-dev/SKILL.md`
    `.claude/skills/xmtp-signet-use/SKILL.md`
    `.claude/skills/xmtp-signet-dev/references/architecture.md`
    `.claude/skills/xmtp-signet-dev/references/key-hierarchy.md`
    `.claude/skills/xmtp-signet-dev/references/packages.md`
    `.claude/skills/xmtp-signet-use/references/content-types.md`
    `.claude/skills/xmtp-signet-use/references/trust-model.md`
  - Verified:
    - `git diff --check`
    - `rg -n "xs session|xs grant|session token|view configuration|grant enforcement|Session Key|createSessionKeyManager|session-scoped auth|GrantDeniedError|RevealGrant|createAttestationSigner|attestation-lifecycle|compatibility surfaces still use" .claude/skills .claude/agents`

- `v1/sessions-to-creds`
  - Aligned verifier seal payload checks with the v1 schema cutover in
    `packages/verifier/src/checks/seal-chain.ts`
    `packages/verifier/src/checks/seal-signature.ts`
    `packages/verifier/src/__tests__/fixtures.ts`
    `packages/verifier/src/__tests__/schema-compliance.test.ts`
    `packages/verifier/src/__tests__/seal-chain.test.ts`
    `packages/verifier/src/__tests__/seal-signature.test.ts`
  - Commit: `9002bb4d`
  - Verified:
    - `cd packages/verifier && bun run typecheck`
    - `cd packages/verifier && bun test`
- `v1/credential-manager`
  - Completed the credential-service provenance cutover by threading
    `issuedBy` through
    `packages/sessions/src/service.ts`
    `packages/sessions/src/session-manager.ts`
  - Resolved the Graphite rebase conflict at the branch where the drift was
    actually introduced
  - Verified:
    - `cd packages/sessions && bun run build`
    - `cd packages/sessions && bun test src/__tests__/service.test.ts src/__tests__/session-manager.test.ts`
    - `bun run check`
- `v1/seals-update`
  - Fixed the missing `RevocationSeal` type import in
    `packages/seals/src/stamper.ts`
  - Commit: `8ed9d65d`
  - Verified:
    - `cd packages/seals && bun run typecheck`
    - `cd packages/seals && bun test src/__tests__/manager.test.ts src/__tests__/stamper.test.ts`
- `v1/cli-update`
  - Realigned the CLI smoke test with this branch's actual public surface:
    it still exposes `session issue`, but the payload and WS flow are already
    credential-native
  - Updated
    `packages/cli/src/__tests__/smoke.test.ts`
  - Commit: `d9712c63`
  - Verified:
    - `cd packages/cli && bun test src/__tests__/daemon-command-wiring.test.ts src/__tests__/command-parsing.test.ts`
    - `cd packages/cli && bun test src/__tests__/smoke.test.ts -t "credentialed daemon flow"`
- Restacked the stack after the CLI smoke fix and re-verified:
  - `v1/credential-manager`
    - `bun run check`: green
  - `v1/docs-agents-alignment`
    - `bun run check`: green

- `v1/key-manager-rewrite`
  - Fixed duplicate `TrustTier` export in
    `packages/keys/src/platform.ts`
  - Commit: `788d630`
- `v1/contracts-update`
  - Fixed exported Zod schema annotations for declaration builds in
    `packages/schemas/src/credential.ts`
    `packages/schemas/src/permission-scopes.ts`
    `packages/schemas/src/policy.ts`
  - Commit: `dc77442`
- Restacked entire stack after both fixes
- Verified `bun run check` passes on `v1/docs-agents-alignment`
- Resubmitted updated stack PRs via `gt submit --draft --no-interactive`
- `v1/sessions-to-creds`
  - Renamed the expired-auth cutover from `SessionExpiredError` to
    `CredentialExpiredError` across schemas, sessions, CLI admin client, and
    affected integration tests
  - Replaced stale `packages/integration/src/__tests__/session-lifecycle.test.ts`
    coverage with credential-lifecycle coverage against the exported
    `createCredentialManager` API
  - Fixed a declaration-build issue in `packages/sessions/src/service.ts` by
    importing the contract `CredentialRecord` type
  - Verified:
    - `bun run build --filter @xmtp/signet-schemas`
    - `bun run build --filter @xmtp/signet-sessions`
    - `bun test packages/schemas/src/__tests__/errors.test.ts packages/sessions/src/__tests__/session-manager.test.ts packages/cli/src/__tests__/admin-socket.test.ts packages/integration/src/__tests__/contract-verification.test.ts packages/integration/src/__tests__/session-lifecycle.test.ts`
- `v1/permission-scopes`
  - Restored `packages/schemas/src/view.ts` and
    `packages/schemas/src/grant.ts`
  - Re-exported the restored modules from `packages/schemas/src/index.ts`
  - Fixed `isolatedDeclarations` typing in
    `packages/schemas/src/permission-scopes.ts`
  - Commit: `4f7ad8e`
  - Verified:
    - `cd packages/schemas && bun run typecheck && bun test src/__tests__/view.test.ts src/__tests__/grant.test.ts src/__tests__/events.test.ts src/__tests__/requests.test.ts src/__tests__/permission-scopes.test.ts`
- Verified `bun run check` passes on `v1/docs-agents-alignment` after the
  `v1/permission-scopes` restack
- `v1/key-manager-rewrite`
  - Restored `createKeyManager` and the compat `KeyManager` surface in
    `packages/keys/src/key-manager-compat.ts`
  - Re-exported the compat surface from `packages/keys/src/index.ts`
  - Added dual-signature compat support to
    `packages/keys/src/signer-provider.ts` and
    `packages/keys/src/seal-stamper.ts`
  - Added regression coverage in
    `packages/keys/src/__tests__/key-manager-compat.test.ts`
  - Verified:
    - `cd packages/keys && bun run build && bun run typecheck && bun test src/__tests__/key-manager-compat.test.ts src/__tests__/key-manager.test.ts`
    - `bun run docs:check`
    - `cd packages/integration && bun test src/__tests__/key-hierarchy.test.ts src/__tests__/seal-lifecycle.test.ts`
      - `key-hierarchy` now passes
      - `seal-lifecycle` now fails at the next exposed gap:
        missing `createSessionManager` export from `@xmtp/signet-sessions`
  - Follow-up:
    - adjusted `AdminKeyManager.create()` metadata to be string-compatible so
      both lower and later CLI branches accept the same compat surface
    - absorbed the follow-up into `v1/key-manager-rewrite` with `gt absorb -a`
  - Verified again:
    - `bun run check` passes on `v1/docs-agents-alignment` after the absorb
- `v1/sessions-to-creds`
  - Backported the credential-native transport and integration cutover from the
    first later branch where it had already converged
  - Updated `packages/schemas/src/requests.ts` and
    `packages/schemas/src/__tests__/requests.test.ts` so heartbeat requests are
    credential-based instead of session-based
  - Migrated `packages/ws/src/*` and the WS test suite to
    `CredentialRecord` / `credentialId` / `CredentialReplayState`
  - Migrated the integration harness and affected suites in
    `packages/integration/src/fixtures/test-runtime.ts`
    `packages/integration/src/__tests__/contract-verification.test.ts`
    `packages/integration/src/__tests__/happy-path.test.ts`
    `packages/integration/src/__tests__/policy-enforcement.test.ts`
    `packages/integration/src/__tests__/seal-lifecycle.test.ts`
    `packages/integration/src/__tests__/session-lifecycle.test.ts`
    `packages/integration/src/__tests__/ws-edge-cases.test.ts`
  - Verified:
    - `cd packages/ws && bun run typecheck && bun test`
    - `cd packages/integration && bun run typecheck && bun test`
    - `cd packages/schemas && bun test src/__tests__/requests.test.ts`
    - `bun run check`
      - now only fails at the next later-stack seam:
        `@xmtp/signet-verifier` still importing removed `SealSchema` and
        `TrustTier` exports from `@xmtp/signet-schemas`
- `v1/full-build-fix` through `v1/docs-agents-alignment`
  - Tightened credential issuer provenance so `CredentialRecord.issuedBy`
    models the actual issuer instead of echoing the subject operator
  - Added `CredentialIssuer` / `CredentialIssuerType` in
    `packages/schemas/src/credential.ts`
  - Threaded issuance provenance through
    `packages/contracts/src/services.ts`
    `packages/sessions/src/session-manager.ts`
    `packages/sessions/src/service.ts`
    `packages/sessions/src/actions.ts`
  - Updated the HTTP admin path to preserve the verified admin fingerprint in
    `packages/keys/src/key-manager-compat.ts`
    `packages/cli/src/runtime.ts`
    `packages/cli/src/http/server.ts`
  - Added regression coverage in
    `packages/schemas/src/__tests__/credential.test.ts`
    `packages/sessions/src/__tests__/service.test.ts`
    `packages/sessions/src/__tests__/credential-actions.test.ts`
    `packages/cli/src/__tests__/http-server.test.ts`
    `packages/cli/src/__tests__/http-api-integration.test.ts`
  - Verified:
    - `cd packages/schemas && bun test src/__tests__/credential.test.ts`
    - `cd packages/sessions && bun test src/__tests__/service.test.ts src/__tests__/credential-actions.test.ts`
    - `cd packages/cli && bun test src/__tests__/http-server.test.ts src/__tests__/http-api-integration.test.ts`
    - filtered typecheck across schemas/contracts/keys/sessions/cli
- `v1/full-build-fix` through `v1/docs-agents-alignment`
  - Kept scope narrowing in-place and reserved revocation for true
    reauthorization events in
    `packages/contracts/src/credential-types.ts`
    `packages/sessions/src/update-actions.ts`
    `packages/cli/src/ws/request-handler.ts`
  - Added coverage in
    `packages/sessions/src/__tests__/update-actions.test.ts`
    `packages/sessions/src/__tests__/session-update-integration.test.ts`
    `packages/cli/src/__tests__/ws-request-handler.test.ts`
  - Verified:
    - `cd packages/sessions && bun test src/__tests__/update-actions.test.ts src/__tests__/session-update-integration.test.ts`
    - `cd packages/cli && bun test src/__tests__/ws-request-handler.test.ts`
- `v1/docs-agents-alignment`
  - Completed the cutover-only public surface cleanup:
    - deleted `packages/cli/src/commands/grant.ts`
    - renamed the canonical CLI lifecycle surface from `session` to
      `credential`
    - removed the legacy `/v1/session/:method` HTTP credential route
    - deleted `packages/schemas/src/view.ts`
    - deleted `packages/schemas/src/grant.ts`
  - Updated repo docs, SDK/docs wording, and agent references to match the
    credential/operator/policy/seal model in
    `README.md`
    `CLAUDE.md`
    `docs/architecture.md`
    `docs/concepts.md`
    `docs/development.md`
    `packages/sdk/src/index.ts`
    `packages/sdk/src/types.ts`
    `.claude/skills/xmtp-signet-dev/references/packages.md`
  - Updated CLI wiring and smoke coverage in
    `packages/cli/src/index.ts`
    `packages/cli/src/__tests__/command-parsing.test.ts`
    `packages/cli/src/__tests__/daemon-command-wiring.test.ts`
    `packages/cli/src/__tests__/smoke.test.ts`
  - Verified:
    - `cd packages/cli && bun test src/__tests__/command-parsing.test.ts src/__tests__/daemon-command-wiring.test.ts src/__tests__/smoke.test.ts`
    - `cd packages/cli && bun run typecheck`
    - `cd packages/sdk && bun run typecheck`
    - `bun run check`

## Active Clusters

- Mid-stack verifier schema drift
  - Branch region: `v1/seal-auto-republish` through `v1/xs-policy-seal`
  - Symptoms:
    - `packages/verifier` still imports removed `SealSchema`, `Seal`, and
      `TrustTier` exports from `@xmtp/signet-schemas`
    - `bun run check` on `v1/sessions-to-creds` now falls through cleanly to
      this later failure in `@xmtp/signet-verifier`
  - Need:
    - backport the verifier-side schema import migration to the earliest branch
      that introduced the mismatch

- Top-of-stack cleanup candidates
  - Branch region: `v1/full-build-fix` through `v1/docs-agents-alignment`
  - Symptoms:
    - remaining public/docs naming may still use `session` language in a few
      comments, test names, or command descriptions
    - the stack is green at the tip, but we still need another bottom-up sweep
      to find branch-local regressions that top-of-stack convergence masks
  - Need:
    - keep checking earlier cut points and push any real local bugs downward

## Boundary Sweep

- `v1/docs-agents-alignment`
  - `bun run check`: green
  - Notes:
    - merge-candidate tip is stable after the latest absorb/restack pass

- `v1/full-build-fix`
  - `bun run check`: red
  - First exposed failure:
    - `packages/sessions` test suite still references `src/service.ts` from
      `reveal-actions.test.ts` during the in-progress lower-stack cutover
  - Status:
    - not yet an independently green checkpoint in the current stack shape

- `v1/sdk-update`
  - `bun run check`: red
  - First exposed failure:
    - `@xmtp/signet-verifier` still imports removed schema exports such as
      `TrustTier` and `SealSchema`

- `v1/cli-update`
  - `bun run check`: red
  - First exposed failure:
    - `@xmtp/signet-sessions` typecheck drift in `src/service.ts` after the
      credential-issuer provenance changes were absorbed downward
  - Notes:
    - errors mention `issuedBy`, `CredentialServiceIssueOptions`, and two stale
      references (`materialityResult`, `nextScopes`)

- `v1/sessions-to-creds`
  - `bun run check`: red
  - First exposed failure:
    - `@xmtp/signet-verifier` typecheck still depends on removed
      `SealSchema` / `TrustTier` exports

- `v1/contracts-update`
  - `bun run check`: red
  - First exposed failure:
    - `@xmtp/signet-ws` tests still expect `SessionToken` from
      `@xmtp/signet-schemas`

- Stack mechanics
  - The latest `gt restack` exposed and cleared a real conflict at
    `v1/phase1-tests` on `packages/schemas/src/credential.ts`
  - Resolution preserved the descendant/top-of-stack schema shape rather than
    reintroducing the earlier contracts-side drift

## Next

- [x] Patch `v1/key-manager-rewrite` by restoring the key-manager compat layer
- [x] Commit and restack the `v1/key-manager-rewrite` cleanup
- [x] Inspect and patch `v1/sessions-to-creds`
- [x] Commit and restack the `v1/sessions-to-creds` cleanup
- [x] Patch credential issuer provenance and HTTP admin fingerprint preservation
- [x] Patch scope-update semantics to narrow in place and revoke only on
  reauthorization
- [x] Complete the cutover-only CLI/docs cleanup on the top branch
- [ ] Inspect and patch the verifier schema drift on the earliest affected branch
- [ ] Re-check the top branch after each restack
- [ ] Continue bottom-up through remaining branch-local regressions
