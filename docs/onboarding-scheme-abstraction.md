# Onboarding Scheme Abstraction

Status: proposed
Last updated: 2026-04-17
Parent issue: #318

## Goal

Decouple Signet's onboarding flow from the Convos-specific implementation so
the signet runtime can support other invite, join, and profile schemes without
changing the credential, policy, or seal model.

This is an abstraction exercise, not a protocol rewrite. Convos remains the
first and only scheme in this stack.

## Hard compatibility guardrail

The Convos wire protocol is fixed for interoperability. This stack must not
change:

- content type strings such as `convos.org/join_request:1.0`
- protobuf field numbers or layouts
- invite crypto defaults such as HKDF salt `"ConvosInviteV1"`
- signature algorithm or verification behavior
- invite tag storage or validation semantics
- joiner-side slug extraction behavior from invite URLs

The abstraction exists so a different scheme can coexist later. It does not
make the Convos protocol itself configurable on the wire.

## Proposed interface

Add a single `OnboardingScheme` interface in `packages/core` that owns:

- invite generation, parsing, and verification
- host-side join request processing
- profile update and snapshot encoding
- profile resolution from message history
- content codec registration and content-type accessors

Convos remains one concrete implementation behind that interface.

## Scope of change

### Changes in this stack

- define the `OnboardingScheme` contract and supporting types
- extract shared invite crypto primitives into reusable utilities
- wrap the current Convos behavior in `createConvosOnboardingScheme()`
- inject the scheme into conversation actions, join orchestration, and SDK
  codec registration
- add `[onboarding] scheme = "convos"` to CLI config and resolve it at startup
- move `packages/core/src/convos/` to `packages/core/src/schemes/convos/`

### Explicit non-goals

- no plugin loading or dynamic scheme discovery
- no multi-scheme-per-signet support
- no redesign of identity mode behavior
- no user-facing CLI taxonomy change beyond onboarding config
- no protocol migration for existing Convos messages or invites

## Runtime model

Each signet instance resolves exactly one onboarding scheme at startup:

```toml
[onboarding]
scheme = "convos"
```

The runtime resolves the configured ID with a static switch and passes the
resulting scheme object into the core seams that need it.

## Integration points

The scheme gets wired into these internal seams:

- `createConversationActions(...)`
- `joinConversation(...)`
- `createSdkClientFactory(...)`
- SDK content-type detection in `sdk-client.ts`
- invite-host startup wiring in `packages/cli/src/start.ts`

## Migration order

1. Define the interface and types
2. Extract shared crypto utilities
3. Implement the Convos scheme wrapper
4. Add equivalence tests proving byte-for-byte compatibility
5. Swap internal call sites to the injected scheme
6. Add config and runtime resolution
7. Move files under `schemes/convos/`

The equivalence suite is the main safety gate. No behavioral call-site swap
should land before it passes.
