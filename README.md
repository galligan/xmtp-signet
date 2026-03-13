# xmtp-broker

An agent broker for XMTP-based applications.

The broker is the real XMTP client. Agent harnesses never touch raw credentials, databases, or signing keys directly. Instead, they connect to the broker over a controlled interface and receive a filtered **view** of conversations and a scoped **grant** of allowed actions.

## Core ideas

- **Broker** — trusted runtime that owns the XMTP client, signer material, and encrypted database
- **View** — policy-filtered projection of what an agent can see
- **Grant** — structured description of what an agent can do
- **Attestation** — signed, group-visible declaration of an agent's current permissions
- **Session** — ephemeral authorization context between harness and broker

## Status

Early development. No runnable code yet.

# Check status
bun run packages/cli/src/bin.ts broker status --json

# Create a group and invite someone
bun run packages/cli/src/bin.ts conversation create --name "test" --as my-agent
bun run packages/cli/src/bin.ts conversation invite <group-id> --as my-agent

# Issue a session for an agent harness
bun run packages/cli/src/bin.ts session issue --agent <inbox-id> --view @view.json --grant @grant.json
```

This installs workspace dependencies, installs git hooks, and verifies that
the local CLI tools used by the repo are available.

## Planning

See [.agents/docs/init/xmtp-broker.md](.agents/docs/init/xmtp-broker.md) for the full product requirements document.
