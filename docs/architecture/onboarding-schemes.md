# Onboarding Schemes

Status: current on `main`

This document explains the onboarding abstraction that now sits between the
core runtime and the Convos invite/profile flow.

## Goal

Decouple Signet's onboarding flow from the Convos-specific implementation so
the runtime can support other invite, join, and profile schemes later without
rewriting the credential, policy, or seal model.

This is an internal abstraction boundary, not a protocol rewrite. Convos
remains the first and only supported scheme today.

## Current Runtime Model

Each signet instance resolves exactly one onboarding scheme at startup:

```toml
[onboarding]
scheme = "convos"
```

The CLI resolves that scheme ID with a static switch and passes the resulting
scheme object into the core seams that need it.

Current note:

- the shipped abstraction is real
- the only supported scheme ID is `convos`
- user-facing invite and profile behavior is still Convos-specific

## What The Scheme Owns

The shared `OnboardingScheme` interface lives in
`packages/core/src/schemes/onboarding-scheme.ts`.

It owns:

- invite generation, parsing, and verification
- host-side join request processing
- profile update encoding
- profile snapshot encoding
- profile resolution from message history
- onboarding codec registration and encoded-content detection

Shared invite crypto helpers live in
`packages/core/src/schemes/invite-crypto.ts`.

## Current Convos Implementation

The concrete implementation is:

- `createConvosOnboardingScheme()` in
  `packages/core/src/convos/onboarding-scheme.ts`

The runtime still keeps the concrete Convos modules under `packages/core/src/convos/`.
The abstraction layer sits alongside that tree rather than fully relocating it
under `schemes/`.

The Convos scheme wraps the existing:

- invite generator and parser
- join request content and host-side processor
- profile update and snapshot codecs
- profile resolution helpers
- codec registration

## Wiring Points

The resolved scheme is injected into these seams:

- conversation actions
- join orchestration
- SDK client factory
- SDK onboarding content-type detection
- invite-host startup wiring in the CLI

That means the runtime no longer hardcodes Convos behavior at those call sites,
even though the configured scheme is still always `convos`.

## Compatibility Guardrail

The Convos wire protocol is fixed for interoperability. The abstraction must
not change:

- content type strings such as `convos.org/join_request:1.0`
- protobuf field numbers or layouts
- invite crypto defaults such as HKDF salt `"ConvosInviteV1"`
- signature algorithm or verification behavior
- invite tag storage or validation semantics
- joiner-side slug extraction behavior from invite URLs

The abstraction exists so another scheme can coexist later. It does not make
the Convos wire format itself configurable on the wire.

## User-Facing Consequences

### Invite output remains Convos-shaped

The current Convos scheme still generates Convos invite URLs:

- `https://dev.convos.org/v2?...` for `dev` and `local`
- `https://popup.convos.org/v2?...` for `production`

### Profile defaults come from config

`defaults.profileName` is the default human-facing profile name used by common
join and invite flows. `xs init --label ...` seeds it when the config is first
written and the field is still unset.

### Raw image URLs are not accepted for Convos profile messages

The current Convos profile codec requires encrypted image metadata rather than
plain image URLs. In practice that means the scheme can surface a resolved
`imageUrl` from history, but callers should not expect to publish arbitrary raw
image URLs through the profile update path.

## Non-Goals

Still intentionally out of scope:

- plugin loading or dynamic scheme discovery
- multi-scheme-per-signet support
- protocol migration for existing Convos content
- user-facing CLI taxonomy changes beyond the onboarding config field

## Related Docs

- [../cli.md](../cli.md) for the live invite/join commands
- [../configuration.md](../configuration.md) for the `[onboarding]` config
  block
- [runtime.md](./runtime.md) for the broader runtime seams
