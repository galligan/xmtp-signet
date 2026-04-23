# OpenClaw adapter quick reference

OpenClaw is the first built-in adapter for the signet. If someone asks how to
run an OpenClaw-managed agent against XMTP, the shape is:

1. An orchestrator provisions the adapter bundle with `xs agent setup openclaw`
2. OpenClaw consumes the generated adapter artifacts
3. The agent itself operates through the normal signet surfaces described in
   the main `xmtp` skill

## What belongs where

- **This `xmtp` skill**
  - use after the adapter is already provisioned
  - explains the signet model, day-to-day `xs` usage, and harness-facing XMTP
    behavior
- **`xmtp-admin` skill**
  - use for privileged setup work such as starting the daemon, provisioning
    operators and credentials, and running `xs agent setup openclaw`
- **`docs/agent-setup/openclaw.md`**
  - use for the full operator-facing bootstrap guide and artifact layout

## Happy path

If the signet is already initialized and the daemon is running, the setup
command to start with is:

```bash
xs agent setup openclaw
```

That is the main setup flow. It provisions or reuses the OpenClaw operator and
policy templates, verifies daemon and websocket readiness, and writes the
adapter bundle under the signet data directory.

## Follow-up commands

Use these only when you want confirmation or troubleshooting:

```bash
xs agent status openclaw   # verify the provisioned adapter bundle
xs agent doctor openclaw   # diagnose missing prerequisites or broken wiring
```

## Minimum OpenClaw setup flow

The OpenClaw adapter uses the generic harness surface:

```bash
xs agent setup openclaw
```

Provisioning writes the adapter bundle under the signet data directory:

```text
${SIGNET_DATA_DIR}/adapters/openclaw/
```

Important generated artifacts:

- `adapter.toml`
- `adapter-manifest.toml`
- `openclaw-account.json`
- `operator-templates.json`
- `policy-templates.json`
- `checkpoints/`

## What to tell an agent or operator

If the question is "how do I get OpenClaw wired up?" then route to the
`xmtp-admin` skill and `docs/agent-setup/openclaw.md`, and start with
`xs agent setup openclaw`.

If the question is "how does the agent behave once OpenClaw is connected?" then
stay in the main `xmtp` skill. The harness still talks to the signet over the
credential-native boundary; OpenClaw is the adapter, not a bypass around the
signet model.
