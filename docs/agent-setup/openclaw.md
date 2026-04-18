# OpenClaw Adapter Setup Guide

This is the operator-facing bootstrap guide for the first-party OpenClaw adapter.
On this branch, setup focuses on durable provisioning over signet primitives and
writing the adapter configuration bundle the OpenClaw side consumes.

OpenClaw setup uses the generic adapter surface:

```bash
xs agent <verb> <harness>
```

and currently supports:

- `xs agent setup openclaw`
- `xs agent status openclaw`
- `xs agent doctor openclaw`

## Prerequisites

- `xs` is configured and initialized (`xs init`) so an admin key exists.
- The daemon is running (`xs daemon start`).
- WebSocket is enabled and bound in config (or default):
  - `ws.port` must be a positive integer.
  - `ws.host` typically `127.0.0.1`.
- You can resolve the active config path.
  - If omitted, `xs` uses its default config path.
  - If you use a custom config, pass `--config <path>` to setup/status/doctor.

OpenClaw is registered as a built-in adapter, so no explicit `[agent.adapters.openclaw]`
entry is required to run `xs agent setup openclaw`.

For stable paths, confirm `signet.dataDir` if you set it explicitly, otherwise
the default XDG location resolves to `~/.local/share/xmtp-signet`.

## Signet-side setup

1. Make sure the daemon is live and websocket transport is ready:

```bash
xs status --json
```

2. Run OpenClaw provisioning:

```bash
xs agent setup openclaw --json
```

Use a custom config path with:

```bash
xs agent setup openclaw --config /path/to/config.toml --json
```

3. If you need to rewrite generated files (for example after a bad manual edit),
re-run with force:

```bash
xs agent setup openclaw --config /path/to/config.toml --force --json
```

Successful setup returns a structured result with:

- `created`: newly created operators, policies, and artifacts.
- `reused`: already-existing resources and artifacts.
- `artifacts`: map of artifact label to absolute path.
- `nextSteps`: follow-up commands.

Typical output shape:

```json
{
  "created": ["operator:openclaw-main", "policy:openclaw-readonly", ...],
  "reused": ["operator:openclaw-subagent-per-chat", ...],
  "artifacts": {
    "adapter.toml": "/.../adapters/openclaw/adapter.toml",
    "adapter-manifest.toml": "/.../adapters/openclaw/adapter-manifest.toml",
    "openclaw-account.json": "/.../adapters/openclaw/openclaw-account.json",
    "operator-templates.json": "/.../adapters/openclaw/operator-templates.json",
    "policy-templates.json": "/.../adapters/openclaw/policy-templates.json"
  }
}
```

## `xs agent setup openclaw`

This command performs four classes of work:

1. Verifies daemon readiness:
   - daemon state is `running`.
   - websocket port is available.
2. Ensures operator templates exist in signet:
   - `openclaw-main`
   - `openclaw-subagent-per-chat`
   - `openclaw-specialist-shared`
3. Ensures policy templates exist in signet:
   - `openclaw-readonly`
   - `openclaw-standard-reply`
   - `openclaw-draft-only`
   - `openclaw-group-helper`
4. Writes adapter artifacts into the signet data directory.

If an operator or policy already exists with one of these labels, it is reused.
If the resource already exists with duplicate labels, setup fails with a
validation error so the operator can resolve label conflicts explicitly.

## generated artifacts and their meaning

Artifacts are written under:

`$SIGNET_DATA_DIR/adapters/openclaw/`

where `$SIGNET_DATA_DIR` is `signet.dataDir` if set, otherwise the resolved
default data directory.

- `adapter.toml`
  - Core adapter wiring for OpenClaw.
  - Captures transport endpoint (`[transport.ws]`) and artifact root/checkpoints
    paths.
  - Stores the operator and policy bindings as map entries under
    `[operators]` and `[policies]`.

- `adapter-manifest.toml`
  - Built-in manifest for the adapter contract (`setup`, `status`, `doctor`).
  - Useful for interoperability/auditing and for parity with external-adapter
    manifests.

- `openclaw-account.json`
  - Account payload for OpenClaw consumption.
  - Includes:
    - adapter descriptor (`adapter: openclaw`, `source: builtin`)
    - signet runtime locator (`configPath`, `dataDir`, `adminSocket`, `wsPort`)
    - resolved operator IDs map
    - resolved policy IDs map

- `operator-templates.json`
  - Canonical export of operator template definitions plus resolved operator IDs.

- `policy-templates.json`
  - Canonical export of policy template definitions plus resolved policy IDs.

- `checkpoints/`
  - Directory reserved for the bridge checkpoint store.
  - Created during setup so downstream bridge components can persist replay
    state in a known place.

## wiring OpenClaw to generated adapter config

Treat the folder as the adapter root:

```text
${SIGNET_DATA_DIR}/adapters/openclaw/
```

Recommended wiring flow:

1. Keep this directory writable by OpenClaw runtime process users.
2. Feed `adapter.toml` to the OpenClaw adapter layer if your deployment loads a
   single config file.
3. Pass/copy `openclaw-account.json` as the signet adapter account descriptor.
4. Use `operator-templates.json` / `policy-templates.json` as your reference map
   for role-to-ID alignment.
5. Reserve `checkpoints/` for OpenClaw bridge state persistence.

The adapter package is currently scaffolded through the setup boundary, so bridge
wiring is intentionally explicit here to avoid hidden auto-start assumptions.

## first verification flow

1. Confirm setup wrote artifacts. If you changed `signet.dataDir`, set
   `SIGNET_DATA_DIR` for the command:

```bash
# If you are using defaults:
ls -la ~/.local/share/xmtp-signet/adapters/openclaw

# If your config sets [signet] dataDir, use that directory instead.
export SIGNET_DATA_DIR="/absolute/path/to/dataDir"
ls -la "${SIGNET_DATA_DIR}/adapters/openclaw"
```

2. Inspect adapter status:

```bash
xs agent status openclaw --json
```

Expected post-setup shape:

- `details.phase: "runtime"`
- `details.bridgePhase: "read-only"`
- `details.bridgeReady: true`
- `details.presentArtifacts` includes:
  - `adapter.toml`
  - `adapter-manifest.toml`
  - `openclaw-account.json`
  - `operator-templates.json`
  - `policy-templates.json`
- `details.missingArtifacts` is empty
- `details.checkpointsDirExists` is `true`

`status` resolves as:

- `ok` when all expected artifacts are present and `checkpoints/` exists
- `degraded` when setup is partially present
- `missing` when the adapter root is not provisioned yet

3. Run doctor for installation diagnostics:

```bash
xs agent doctor openclaw --json
```

Expected doctor behavior:

- `status: "ok"` when the provisioned bundle is complete
- diagnostics mention that adapter artifacts are present and read-only bridge
  primitives are available

If setup is incomplete, doctor calls out:

- missing artifact files
- missing `checkpoints/` directory
- the recommendation to rerun `xs agent setup openclaw`

4. Validate signet side state in the config artifacts:

- `openclaw-account.json` includes the active websocket port and admin socket.
- Operator/policy IDs in `operator-templates.json` and `policy-templates.json`
  match IDs in `openclaw-account.json`.

## troubleshooting/common failures

- `Signet daemon must be running before adapter setup`
  - Start the daemon first: `xs daemon start`.

- `WebSocket transport must be enabled before adapter setup`
  - Check `ws.port` in config; `0` means no websocket transport for adapter
    setup.

- `No admin key found. Run 'xs init' first.`
  - You are missing the admin key material; run `xs init` and retry.

- `adapter 'openclaw' not found`
  - The local config is not resolving the built-in adapter registry.
  - Verify `agent.adapters` does not incorrectly override `openclaw`, or remove
    conflicting config and retry.

- Duplicate template labels (validation error)
  - This indicates multiple signet operators/policies already use the same
    adapter template label.
  - Clean up duplicates before re-running setup.

- Repeated setup appears not to update existing files
  - Re-run with `--force` if you intentionally want to overwrite generated
    artifact files.

- `status` shows `degraded` after setup
  - Inspect `details.missingArtifacts` and `details.checkpointsDirExists`.
  - The most common cause is partial manual cleanup inside
    `${SIGNET_DATA_DIR}/adapters/openclaw/`.
  - Re-run `xs agent setup openclaw --force` to regenerate the artifact bundle.

- You need to verify the bridge runtime itself
  - The adapter now ships the first read-only bridge slice.
  - `xs agent status openclaw --json` confirms the provisioned adapter bundle
    and bridge prerequisites, but it does not prove a live bridge process is
    currently connected to signet.
  - Bridge checkpoint files will appear under `checkpoints/` once a runtime
    actually consumes the adapter bundle and starts persisting replay state.
