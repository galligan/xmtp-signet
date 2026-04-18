# Architecture Docs

These docs explain how the current runtime is put together and where the newer
seams live.

## Current-State Architecture

- [runtime.md](./runtime.md) — package tiers, handler contract, event model,
  auth surfaces, and the live CLI/runtime composition
- [adapters.md](./adapters.md) — adapter workspace boundary, registry model,
  and built-in vs external harness integrations
- [onboarding-schemes.md](./onboarding-schemes.md) — current onboarding
  abstraction, Convos integration, and compatibility guardrails

## Proposed / In-Progress Design Work

- [outbound-event-bridge.md](./outbound-event-bridge.md) — proposed bridge for
  replay-safe outbound delivery on top of the canonical event stream

## Related Docs

- [../concepts.md](../concepts.md) — conceptual model and trust language
- [../configuration.md](../configuration.md) — config file and preset behavior
- [../security.md](../security.md) — threat model and admin-read elevation
