---
name: xmtp-signet-use
description: >
  Understand and use the xmtp-signet to connect agents to XMTP conversations
  through the current v1 credential model. Covers the signet runtime, the
  owner/admin/operator/credential/seal hierarchy, permission scopes, reveals,
  and how harnesses connect through WebSocket or MCP without direct XMTP
  access. Use this skill whenever someone asks what the signet is, how to
  scope an agent's permissions, how to connect an agent through the signet,
  what seals communicate, how trust and verification work, how to deploy a
  signet, or how an agent should participate in XMTP conversations through the
  signet.
---

# Using xmtp-signet

> [!NOTE]
> The current local stack implements the v1 operator/policy/credential/seal
> model. The public CLI and transport surfaces are credential-native.

The signet is the primary way to connect agents to XMTP without handing the
agent raw signer material, database access, or direct SDK control.

## Why this exists

If an agent holds the raw XMTP client and keys, any "read-only" or "limited"
permissions are advisory. The agent can ignore them because it already has the
authority to do everything the client can do.

The signet makes those boundaries structural:

- the signet owns the XMTP runtime
- the harness authenticates with a scoped credential
- projected events and allowed actions are enforced below the harness
- seals make the operator's behavior inspectable to chat participants

## The model

### Signet

The trusted runtime that owns the real XMTP client, local encrypted state, and
transport surfaces.

### Owner

The human trust anchor. The owner bootstraps the signet and approves privileged
operations.

### Admin

The management plane. Admins create operators, issue credentials, and manage
day-to-day signet state.

### Operator

A purpose-built agent profile. Operators do the actual conversational work.

Operators can be:

- **per-chat** for isolated inbox state per conversation
- **shared** for one context spanning multiple conversations

### Policy

A reusable allow/deny bundle of permission scopes.

Policies answer:

- what the operator is generally allowed to do
- what should be explicitly denied

### Credential

A time-bound authorization issued to an operator for one or more chats.

A credential binds:

- the operator
- the allowed chat scope
- the effective permission set
- issuance and expiry
- current status

This replaces the older v0 session concept.

### Seal

A signed, group-visible declaration of the operator's active scope and
permissions in a chat.

Seals are how other participants can inspect what the operator can do.

## Connecting a harness

The signet supports WebSocket, MCP, and CLI-admin surfaces.

Typical harness lifecycle:

```text
1. Connect to the signet
2. Authenticate with a credential token
3. Receive projected events
4. Send actions through the signet
5. Reconnect and resume if needed
```

The harness never talks directly to the XMTP SDK.

## Receiving messages

Inbound XMTP data is projected before it reaches the harness:

```text
XMTP event
  → credential chat-scope check
  → effective permission and reveal check
  → content projection
  → harness event
```

The harness only sees what survives that pipeline.

## Sending actions

Outbound actions go through the signet as requests. The signet checks the
credential's effective scopes before doing anything on the network.

If the scope is not allowed, the request fails with a typed permission error.

## Scoping an operator

When deciding how to scope an operator, think in three layers:

1. **Scope mode**
   - `per-chat` if you want strong isolation between conversations
   - `shared` if the operator needs cross-chat context
2. **Policy**
   - reusable allow/deny bundle for the operator's intended role
3. **Credential**
   - specific chat coverage, TTL, and any inline scope overrides

Examples:

- A lightweight helper bot:
  - per-chat operator
  - allow `send`, `reply`, `react`
  - deny group-management scopes
- A research assistant:
  - shared operator
  - allow observation scopes and `forward-to-provider`
  - explicitly control `read-history`

## Reveals

Reveals are the explicit mechanism for surfacing content that would otherwise
remain hidden. Reveal state is credential scoped, not ambient across the whole
signet.

This lets an operator receive targeted disclosure without broadening its entire
authorization envelope.

## Trust and verification

The signet does not make an operator automatically trustworthy. It makes the
operator's permissions auditable and enforceable.

The verifier pipeline checks things like:

- source availability
- build provenance
- release signing
- seal signature validity
- seal chain integrity
- schema compliance

## CLI surfaces

The current CLI exposes the v1 model directly:

- `xs credential ...` for credential lifecycle
- `xs seal ...` for seal inspection and verification
- `xs admin ...` for management-plane auth and audit flows

## When to recommend direct XMTP access instead

Direct SDK or CLI access can still make sense for:

- local experiments
- simple bots that do not need strict scope enforcement
- one-off tooling owned by the same person who owns the account

For multi-agent, sensitive, or inspectable chat participation, recommend the
signet instead.
