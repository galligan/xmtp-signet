# Onboarding Scheme Stack

Status: active
Last updated: 2026-04-17
Parent issue: #318

## Goal

Implement the onboarding-scheme abstraction as a linear Graphite stack without
changing Convos wire compatibility.

## Stack invariants

- one branch per issue, one commit per branch
- keep the stack linear even where issue dependencies are parallel
- preserve byte compatibility with existing Convos invite, join, and profile
  flows throughout the stack
- use `Refs #318` on the kickoff PR; do not close the epic until the subissue
  stack is merged

## Execution order

| Order | Issue | Branch | Commit / PR title |
|---|---:|---|---|
| 0 | #318 | `v1/onboarding-kickoff` | `docs(onboarding): add onboarding-scheme stack execution guide` |
| 1 | #319 | `v1/onboarding-scheme-contract` | `feat(core): define onboarding scheme contracts` |
| 2 | #320 | `v1/invite-crypto` | `refactor(core): extract shared invite crypto` |
| 3 | #321 | `v1/convos-onboarding-scheme` | `feat(core): implement convos onboarding scheme` |
| 4 | #322 | `v1/onboarding-equivalence` | `test(core): add onboarding equivalence coverage` |
| 5 | #323 | `v1/onboarding-conversation-di` | `refactor(core): inject onboarding scheme into conversation actions` |
| 6 | #324 | `v1/onboarding-sdk-codecs` | `refactor(core): source codecs from onboarding scheme` |
| 7 | #325 | `v1/onboarding-scheme-config` | `feat(cli): configure onboarding scheme resolution` |
| 8 | #326 | `v1/onboarding-schemes-move` | `chore(core): move convos implementation under schemes` |

## Branch intent

### #318 kickoff

- add tracked docs for the abstraction and execution order
- no runtime code changes

### #319-#321 foundation

- define the `OnboardingScheme` surface in `packages/core`
- extract shared crypto helpers
- wrap current Convos behavior in a scheme implementation

### #322 safety gate

- add equivalence tests for invite generation, parsing, verification, profile
  encoding, and host-side join processing
- do not swap internal call sites before this branch is green

### #323-#325 functional cutover

- inject the scheme into conversation actions and join orchestration
- source codecs from the resolved scheme in the SDK layer
- add CLI config and resolve the scheme once at startup

### #326 cleanup

- move the Convos implementation under `packages/core/src/schemes/convos/`
- remove remaining direct `convos/` import paths outside `schemes/`

## Review and verification checkpoints

- after `#322`: run targeted core tests plus a top-branch `bun run check`
- after `#325`: run targeted core and CLI tests plus a top-branch `bun run check`
- after `#326`: run import-path sweep and full top-branch `bun run check`
- after each later-stack fix from `#322` onward: `gt absorb -a`, `gt restack`,
  then re-run top-branch verification

## Guardrails

- do not change Convos content-type strings, protobuf layouts, salts, or
  signature behavior
- keep user-facing CLI help text Convos-specific where behavior is still
  Convos-only in this stack
- do not widen scope into plugin loading, multi-scheme selection, or identity
  model redesign
