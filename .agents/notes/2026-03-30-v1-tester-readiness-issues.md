# V1 Tester Readiness: Remaining Work and Issue Map

Date: 2026-03-30

## Summary

The signet runtime is meaningfully farther along than the live `xs` user experience.

What is already real today:

- Local/dev identity bootstrap works through the current top-level `xs init` flow.
- The daemon can start locally and connect to XMTP dev.
- Credential issuance works through the live `xs cred` path.
- WebSocket auth and scope enforcement work in local smoke coverage.
- Convos invite generation and join helpers exist as reusable building blocks.

What is still not tester-ready:

- Most of the live `xs` groups still point at cutover stub shells instead of the shared action-spec-backed runtime.
- Operator, policy, and message surfaces are not fully composed into the production runtime.
- The hosted Convos invite loop is not visibly wired into the live daemon path.
- Seal input/provenance wiring is still partial.
- Current smoke/devnet/docs coverage overstates readiness in a few important places.

## GitHub Tracker

- Parent tracker: [#236](https://github.com/galligan/xmtp-signet/issues/236) `v1/ship: close tester-readiness gaps for xs, invites, and seals`

### Child issues

1. [#237](https://github.com/galligan/xmtp-signet/issues/237) `runtime: expose a real operator action surface and production composition`
2. [#238](https://github.com/galligan/xmtp-signet/issues/238) `runtime: expose a real policy action surface and make cred --policy work`
3. [#239](https://github.com/galligan/xmtp-signet/issues/239) `actions: add a real message admin surface for tester-facing chat flows`
4. [#240](https://github.com/galligan/xmtp-signet/issues/240) `convos: close the hosted invite join loop in the live runtime`
5. [#241](https://github.com/galligan/xmtp-signet/issues/241) `seals: wire credential-to-seal input resolution and live provenance behavior`
6. [#242](https://github.com/galligan/xmtp-signet/issues/242) `cli: finish the xs contract-first cutover and retire stub command groups`
7. [#243](https://github.com/galligan/xmtp-signet/issues/243) `qa/docs: add release-gate tracer bullets, real devnet coverage, and refresh the shipped CLI docs`

## Dependency Order

- `#242` depends on `#237`, `#238`, and `#239`.
- `#243` is the release gate and depends on `#238`, `#240`, `#241`, and `#242`.

Practical ship order:

1. `#237` operator runtime/action composition
2. `#238` policy runtime/action composition and real `cred --policy`
3. `#239` message action surface
4. `#240` hosted invite loop closure
5. `#241` seal input/provenance wiring
6. `#242` live CLI cutover
7. `#243` release-gate tracer bullets and docs alignment

## Findings Behind The Issues

### 1. The live `xs` surface is still split between real and stubbed paths

The current top-level CLI still wires many tester-facing groups to `xs-*` files that emit placeholder output instead of calling the running daemon.

Relevant files:

- `packages/cli/src/xs-program.ts`
- `packages/cli/src/commands/xs-chat.ts`
- `packages/cli/src/commands/xs-message.ts`
- `packages/cli/src/commands/xs-operator.ts`
- `packages/cli/src/commands/xs-policy.ts`
- `packages/cli/src/commands/xs-seal.ts`

Counterexample:

- `packages/cli/src/commands/xs-credential.ts` is already daemon-backed and is the clearest reference for the cutover we want.

This is the core reason `#242` exists.

### 2. The shared runtime registry is real, but it does not yet cover every needed domain

The runtime does register credential, reveal, update, signet, and conversation actions through the shared action registry.

Relevant file:

- `packages/cli/src/runtime.ts`

What is notably missing from production registration:

- operator actions
- policy actions
- message actions

That split is why `#237`, `#238`, and `#239` are separate runtime/action issues rather than being treated as pure CLI polish.

### 3. `cred --policy` is not actually closed in production composition yet

The credential service supports policy resolution when a `PolicyManager` is provided, but production startup currently creates the credential service without passing one.

Relevant files:

- `packages/sessions/src/service.ts`
- `packages/cli/src/start.ts`

This is why `#238` is not just a `xs policy` issue. It is also a correctness/runtime-composition issue.

### 4. Operator lifecycle exists as a manager, but not as a shipped live surface

The operator manager itself exists and enforces useful constraints, but it is not yet composed into the production action surface, and the live `xs operator` command tree is still a stub shell.

Relevant files:

- `packages/sessions/src/operator-manager.ts`
- `packages/cli/src/commands/xs-operator.ts`

This is why `#237` exists.

### 5. Message handling exists on the harness side, but not as a polished admin/CLI story

The system can send messages via the WebSocket harness path, but the intended human-facing message CLI is not finished.

Relevant files:

- `packages/cli/src/commands/xs-message.ts`
- `packages/cli/src/commands/message.ts`

This is why `#239` exists.

### 6. Invites are only half-closed today

There is good helper coverage for:

- generating Convos-compatible invite URLs
- joining an invite as the requester
- processing a creator-side join request

But the creator-side hosted invite loop does not appear to be wired into the live daemon runtime.

Relevant files:

- `packages/core/src/conversation-actions.ts`
- `packages/core/src/convos/join.ts`
- `packages/core/src/convos/process-join-requests.ts`
- `packages/core/src/signet-core.ts`

Two specific seams stood out:

- `processJoinRequest(...)` declares `getGroupInviteTag`, but the current implementation never uses it.
- The raw message stream in `signet-core.ts` emits `raw.message` events and stops; I did not find runtime invite-host processing layered on top.

This is why `#240` exists.

### 7. Seal input/provenance is still partially wired

The production `SealManager` is created with an `InputResolver` stub that returns an internal error indicating the credential-to-seal mapping is still pending.

Relevant file:

- `packages/cli/src/start.ts`

This is why `#241` exists.

### 8. Current test and docs coverage still leaves room for false confidence

The current smoke/devnet/docs layer is useful, but not yet a release gate for the tester stories we actually care about.

Relevant files:

- `packages/cli/src/__tests__/smoke.test.ts`
- `packages/cli/src/__tests__/dev-network.test.ts`
- `README.md`
- `CLAUDE.md`
- `docs/architecture.md`
- `docs/development.md`

Important nuance:

- The current smoke test validates auth/scope behavior, but for the in-scope send it still tolerates `not_found` or `internal`, so it does not prove release-grade end-to-end message delivery.
- The real devnet smoke still uses the stale `identity init` entry point instead of the current top-level `init` flow.

This is why `#243` exists and is intentionally the release gate.

## Notes On Inspiration From Trails

The strongest external inspiration for the CLI cutover is the `trails` CLI builder.

Relevant files:

- `~/Developer/outfitter/trails/packages/cli/src/build.ts`
- `~/Developer/outfitter/trails/packages/cli/src/flags.ts`
- `~/Developer/outfitter/trails/packages/cli/src/commander/to-commander.ts`

The main takeaway is straightforward:

- derive a framework-agnostic command model from the authored contract layer
- derive flags from schema
- adapt that command model to Commander

That is a much better fit for the current signet cutover than maintaining duplicate hand-written `xs-*` command trees.

## Open Questions Worth Re-checking During Execution

- Conversation ID boundary: some schema/tests use local `conv_...` IDs while conversation actions and XMTP-facing paths operate on `groupId` strings directly. I did not create a dedicated issue for this yet because I have not fully proved it is a live blocker, but it is worth validating during `#239`, `#240`, and `#243`.
- Shipped message surface: if we intentionally trim the initial `xs msg` scope for testers, `#239` should explicitly document what remains in and what is deferred.

## Intended Outcome

Once the stack above is complete, we should be able to say something much stronger and much simpler:

- the live `xs` CLI is the real surface
- the invite loop closes end-to-end
- seals/provenance are present in live flows
- the shipped docs match the shipped commands
- and we have tracer bullets strong enough to hand the system to testers without caveating half the path
