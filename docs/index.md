# Documentation Index

This directory is the current documentation map for `xmtp-signet` on `main`.
Use it as the entry point when you want the live repository story rather than
older planning notes.

## Start Here

- [../README.md](../README.md) — high-level overview, quick start, and package
  map
- [concepts.md](./concepts.md) — signet model, roles, permissions, projection,
  reveal, and seals
- [cli.md](./cli.md) — the live `xs` command surface and common workflows
- [configuration.md](./configuration.md) — config file layout, XDG paths, env
  overrides, and preset behavior
- [architecture/index.md](./architecture/index.md) — runtime and protocol
  architecture docs
- [security.md](./security.md) — key hierarchy, message access, elevation, and
  threat model
- [development.md](./development.md) — repo layout, testing, conventions, and
  local docs tooling

## Architecture

- [architecture/index.md](./architecture/index.md) — architecture doc map
- [architecture/runtime.md](./architecture/runtime.md) — package tiers,
  transport/runtime seams, event model, and auth surfaces
- [architecture/adapters.md](./architecture/adapters.md) — adapter workspace
  boundary, registry model, and built-in vs external harness integrations
- [architecture/onboarding-schemes.md](./architecture/onboarding-schemes.md) —
  current onboarding abstraction, Convos compatibility guardrails, and runtime
  wiring
- [architecture/outbound-event-bridge.md](./architecture/outbound-event-bridge.md)
  — proposed outbound bridge design layered on top of the canonical event
  stream

## Agent Setup

- [agent-setup/openclaw.md](./agent-setup/openclaw.md) — operator-facing setup
  guide for the OpenClaw adapter and generated artifact bundle

## Security

- [security.md](./security.md) — the broader trust boundary, isolation, and
  admin-read model
- [secure-enclave-integration.md](./secure-enclave-integration.md) —
  Secure Enclave protection and biometric gate behavior

## Internal Design History

These are still useful when you want motivation or implementation history, but
they are not the primary current-state docs:

- [../.agents/docs/init/xmtp-signet.md](../.agents/docs/init/xmtp-signet.md) —
  original PRD and design framing
- [../.agents/plans/v1/v1-architecture.md](../.agents/plans/v1/v1-architecture.md)
  — v1 implementation plan
- [../.agents/plans/v1/onboarding-scheme-stack.md](../.agents/plans/v1/onboarding-scheme-stack.md)
  — execution plan for the onboarding-scheme stack
