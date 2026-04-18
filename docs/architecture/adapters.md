# Adapter Architecture

`xmtp-signet` keeps XMTP custody, policy, credentials, and seals inside the
signet runtime. Harness-specific integrations sit on top of that runtime as
adapters.

This split lets us add harnesses like OpenClaw without teaching the core CLI
or runtime a special-case control plane for each one.

## Why `adapters/` Exists

Core packages under `packages/` define the signet itself:

- `packages/schemas` owns runtime validation and shared types
- `packages/contracts` owns action/service contracts
- `packages/core`, `packages/sessions`, `packages/policy`, and related runtime
  packages own the actual XMTP-facing behavior
- `packages/cli` owns generic user and daemon surfaces

Harness-specific setup and delivery logic belongs somewhere else. The
`adapters/` workspace is that boundary.

Adapters are where we put:

- harness-specific provisioning flows
- generated adapter artifacts and config layouts
- runtime bridge processes that translate signet events into harness-local
  delivery
- reference implementations for future harness authors

Adapters are not where we put:

- raw XMTP custody
- direct key access
- signet policy or credential semantics
- generic CLI taxonomy

## Registry Model

The canonical CLI grammar is:

```bash
xs agent <verb> <harness>
```

The initial verbs are:

- `setup`
- `status`
- `doctor`

The `xs agent` command stays generic. It does four things:

1. Load the effective signet config.
2. Resolve the named adapter through a registry.
3. Validate that the adapter supports the requested verb.
4. Execute the adapter as a process and pass through its stdout, stderr, and
   exit code.

The registry currently resolves adapters from two sources:

- `builtin`
- `external`

## Built-In vs External Adapters

### Built-In

Built-in adapters are first-party workspaces under `adapters/<harness>/`.

They are known to the CLI through a small built-in registry map that provides:

- adapter manifest metadata
- a process command to execute
- optional fixed command arguments

OpenClaw is the first built-in adapter and the current reference shape.

### External

External adapters are adopted explicitly through local config:

```toml
[agent.adapters.custom-harness]
source = "external"
manifest = "./custom-adapter.toml"
command = "./bin/custom-adapter"
```

The CLI validates the external manifest before execution:

- adapter name must match the requested harness
- manifest source must be `external`
- the requested verb must be listed in `supports`
- the manifest must provide an entrypoint for that verb

This keeps external adoption explicit and reviewable while still allowing
adapters to live outside the signet repo.

## Why The First Registry Is Process-Based

The initial adapter registry is intentionally process-based instead of
in-process plugin loading.

That gives us a cleaner trust boundary:

- adapters run as explicit commands
- stdout/stderr/exit code remain visible and debuggable
- adopted external adapters are not silently imported into the signet CLI
- the adapter contract can stay narrow while the ecosystem is still forming

This is also a better fit for harness integrations, which often need their own
runtime behavior, generated files, and environment assumptions.

## Reference Shape: OpenClaw

The first reference adapter lives at:

- `adapters/openclaw/`

Its current shape includes:

- built-in manifest metadata
- a process-backed adapter entrypoint
- `setup`, `status`, and `doctor` handlers
- OpenClaw-specific config, artifact, and bridge modules

The OpenClaw adapter is the reference implementation future adapter authors
should copy when they need:

- a first-party workspace layout
- a built-in registry handoff
- deterministic setup artifacts
- a harness-local bridge layered on top of signet primitives

## Current Contract Surface

Shared adapter contract shapes live in `@xmtp/signet-schemas`:

- adapter name
- adapter source kind
- supported verbs
- entrypoint map
- adopted adapter config
- normalized setup/status result shapes

The generic CLI registry/runner logic lives in `packages/cli`:

- built-in adapter registry
- config-aware adapter resolution
- process execution for resolved adapters
- shared error formatting and exit-code mapping

The harness-specific implementation stays under `adapters/<harness>/`.

## Next Steps

The current stack establishes:

- the adapter workspace boundary
- the generic `xs agent` command family
- OpenClaw as the first built-in adapter
- `xs agent setup openclaw` provisioning on top of native signet primitives

The next major layer is the read-only bridge:

- subscribe to credential-scoped signet streams
- persist replay checkpoints
- dedupe inbound deliveries
- project signet events into OpenClaw-local delivery structures
