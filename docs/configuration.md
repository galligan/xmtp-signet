# Configuration

This document describes the CLI and daemon configuration model for
`xmtp-signet`. For command usage, see [cli.md](./cli.md).

## Default Paths

By default, the signet resolves paths through XDG-style locations:

- config file: `~/.config/xmtp-signet/config.toml`
- data directory: `~/.local/share/xmtp-signet`
- runtime directory: `$XDG_RUNTIME_DIR/xmtp-signet` or the system temp
  directory when `XDG_RUNTIME_DIR` is unset
- admin socket: `<runtime-dir>/admin.sock`
- pid file: `<runtime-dir>/signet.pid`
- audit log: `~/.local/state/xmtp-signet/audit.jsonl`

If `signet.dataDir` is set in the config, it overrides the default data
directory while the XDG-derived config, runtime, and state paths remain in
place unless their specific fields are overridden.

## Example Config

```toml
[onboarding]
scheme = "convos"

[signet]
env = "dev"
identityMode = "per-group"

[defaults]
profileName = "Owner"

[keys]
rootKeyPolicy = "biometric"
operationalKeyPolicy = "open"
vaultKeyPolicy = "open"

[biometricGating]
rootKeyCreation = false
operationalKeyRotation = false
scopeExpansion = false
egressExpansion = false
agentCreation = false
adminReadElevation = true

[ws]
host = "127.0.0.1"
port = 8393

[http]
enabled = false
host = "127.0.0.1"
port = 8081

[admin]
authMode = "admin-key"

[credentials]
defaultTtlSeconds = 3600
maxConcurrentPerOperator = 3
actionExpirySeconds = 300

[agent.adapters.openclaw]
source = "builtin"

[logging]
level = "info"
```

## Sections

### `[onboarding]`

- `scheme = "convos"`

The runtime currently supports exactly one onboarding scheme ID: `convos`.
That scheme owns invite generation and parsing, host-side join processing,
profile update and snapshot codecs, and onboarding content-type detection.

### `[signet]`

- `env = "local" | "dev" | "production"`
- `identityMode = "per-group" | "shared"`
- `dataDir = "/absolute/or/tilde/path"` (optional)

`per-group` is the config literal for the isolation mode that higher-level docs
often describe as “per-chat.”

### `[defaults]`

- `profileName` — default human-facing profile name for Convos onboarding flows

When `xs init --label ...` creates a new config and this field is still unset,
the label becomes the initial `defaults.profileName`.

### `[keys]`

- `rootKeyPolicy = "biometric" | "passcode" | "open"`
- `operationalKeyPolicy = "biometric" | "passcode" | "open"`
- `vaultKeyPolicy = "biometric" | "passcode" | "open"`

These govern the protection level for the root key, operational keys, and the
persisted vault secret material. See [secure-enclave-integration.md](./secure-enclave-integration.md)
for the exact Secure Enclave behavior.

### `[biometricGating]`

Key booleans:

- `rootKeyCreation`
- `operationalKeyRotation`
- `scopeExpansion`
- `egressExpansion`
- `agentCreation`
- `adminReadElevation`

The hardened preset turns on the full gate set, while the recommended preset
primarily leaves `adminReadElevation` enabled and keeps the others off by
default.

### `[ws]`

- `host`
- `port`

The WebSocket surface is the canonical credential-scoped event and request
channel used by first-party SDK clients and bridge-style adapters.

### `[http]`

- `enabled`
- `host`
- `port`

This controls the optional HTTP admin/action surface.

### `[admin]`

- `authMode = "admin-key"`
- `socketPath` (optional)

The local admin socket path defaults under the XDG runtime directory if it is
not explicitly overridden.

### `[credentials]`

- `defaultTtlSeconds`
- `maxConcurrentPerOperator`
- `actionExpirySeconds`

These defaults are what the init presets tune most aggressively.

### `[agent]`

The `[agent]` table groups harness and adapter configuration. Today that
surface is centered on the adapter registry used by `xs agent <verb> <harness>`.

### `[agent.adapters.<name>]`

Each adapter entry is keyed by a lowercase slug such as `openclaw`.

- `source = "builtin" | "external"`
- `manifest` (required for `external`)
- `command` (required for `external`)

Built-in adapters are shipped with the repo and only need a `source = "builtin"`
entry when you want to pin or explicitly enable one in config.

External adapters are adopted by manifest plus process command:

```toml
[agent.adapters.custom-harness]
source = "external"
manifest = "./adapters/custom/adapter.toml"
command = "./bin/custom-harness-adapter"
```

Relative `manifest` and `command` paths resolve relative to the active
`config.toml`.

### `[logging]`

- `level = "debug" | "info" | "warn" | "error"`
- `auditLogPath` (optional)

## Init Presets

`xs init` accepts three named presets. They only modify the fields that define
the initial custody and onboarding posture; environment, paths, and other local
overrides are preserved.

| Preset | Identity mode | Vault key policy | Admin read gate | Default TTL | Max concurrent creds | Action expiry |
| ------ | ------------- | ---------------- | --------------- | ----------- | -------------------- | ------------- |
| `recommended` | `per-group` | `open` | `true` | `3600` | `3` | `300` |
| `trusted-local` | `shared` | `open` | `false` | `43200` | `6` | `1800` |
| `hardened` | `per-group` | `passcode` | `true` | `900` | `1` | `120` |

Additional hardened deltas:

- enables root key creation gating
- enables operational key rotation gating
- enables scope expansion gating
- enables egress expansion gating
- enables agent creation gating

## Environment Variable Overrides

The loader currently supports these environment overrides:

- `XMTP_SIGNET_ENV`
- `XMTP_SIGNET_DATA_DIR`
- `XMTP_SIGNET_WS_PORT`
- `XMTP_SIGNET_WS_HOST`
- `XMTP_SIGNET_HTTP_ENABLED`
- `XMTP_SIGNET_HTTP_PORT`
- `XMTP_SIGNET_HTTP_HOST`
- `XMTP_SIGNET_LOG_LEVEL`

Environment overrides win over TOML file values.

## Status Surface

`xs status --json` returns a daemon status payload that includes:

- `onboardingScheme`
- `xmtpEnv`
- `identityMode`
- `networkState`
- `connectedInboxIds`
- connection and credential counts

That makes the status command a good sanity check after init or config changes.
