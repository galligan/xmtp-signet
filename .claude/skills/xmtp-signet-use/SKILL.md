---
name: xmtp-signet-use
description: >
  Understand and use the xmtp-signet to connect agents to XMTP conversations
  with scoped permissions. Covers the signet model (views, grants, attestations,
  sessions), how to connect an agent harness to the signet, how to scope
  permissions, and how trust verification works. Use this skill whenever someone
  asks what the signet is, how views or grants work, how to connect an agent to
  XMTP through the signet, how to scope an agent's permissions, what
  attestations are, how trust and verification work, how to deploy a signet, or
  when planning how an agent should participate in XMTP conversations. This is
  the primary path for agents on XMTP — use the signet instead of connecting
  to XMTP directly via the CLI or raw SDK.
---

# Using xmtp-signet

> [!CAUTION]
> Early development. The signet architecture is implemented and tested, but
> there is no runnable binary yet. This skill describes the model and how
> things will work — use it to plan harness integration and understand the
> permission system. The concepts are stable even as the API surface evolves.

The signet is the primary way to connect agents to XMTP. Instead of giving
your agent raw access to the XMTP SDK, wallet keys, and encrypted database,
the signet holds all of that and your agent connects through a controlled
interface.

**Why this matters:** When an agent holds raw credentials, any "read-only" or
"limited" permissions are advisory — the agent can do whatever it wants. The
signet makes permissions real by enforcing them below the harness layer.

## The model

Five concepts, each building on the last:

### Signet

The trusted runtime that owns the real XMTP client. It holds the signer,
database, and message sync. Your agent never touches these directly.

One signet can manage multiple agents, each with their own XMTP inbox. The
signet is infrastructure — it doesn't appear in group membership. Each agent
is a distinct participant from the group's perspective.

### View

A policy-filtered projection of what your agent can see. You configure a view
to control:

- **Which conversations** the agent can access (scope)
- **Which content types** the agent receives (allowlist)
- **How much** the agent sees (visibility mode)

| Mode | What the agent sees |
|------|---------------------|
| `full` | All messages in scope |
| `thread-only` | Messages within specific threads only |
| `redacted` | Messages with sensitive content removed |
| `reveal-only` | Only messages explicitly revealed to the agent |
| `summary-only` | Broker-generated summaries, not raw messages |

**Default-deny for content types.** If a content type isn't in the allowlist,
the signet holds it and the agent never sees it. When new content types are
added to the XMTP spec, existing agents don't automatically get them — each
agent's view must explicitly include new types.

### Grant

What your agent is allowed to do. Grants are organized by category:

**Messaging:** send messages, reply in thread, react, draft-only (requires
confirmation before posting)

**Group management:** add/remove members, update metadata, invite users,
change agent policy

**Tool use:** calendar access, payment actions, external HTTP, search/retrieval,
custom application tools

**Egress and retention:** store excerpts, use content for memory, forward to
model providers, quote revealed content, summarize

Views and grants compose independently. An agent can have a `reveal-only`
view with `send + react` capabilities, or a `full` view with `draft-only`
capabilities.

### Seal

A signed, group-visible declaration of what your agent can currently do. When
the signet publishes a seal to a group, every participant can inspect
the agent's permissions — what it sees, what it can do, who owns it, and how
it handles data.

Not every change triggers a new seal. **Material changes** (view mode
changes, grant additions, egress policy changes, agent revocation) produce
attestations. **Routine operations** (session rotation, heartbeats, internal
housekeeping) stay silent. This keeps the conversation timeline clean while
ensuring meaningful permission changes are always visible.

### Session

The ephemeral authorization context between your harness and the signet.
Sessions are short-lived, rotatable, scoped to a specific view and grant,
and revocable. When policy changes are material enough, the session requires
re-authentication under the updated policy.

## Connecting to the signet

> This section describes the target architecture. The wire protocol and
> harness SDK are under development.

Your agent connects to the signet over a transport — WebSocket (primary) or
MCP (for LLM-driven harnesses), with HTTP following. A harness client SDK
(`@xmtp/signet-handler`) provides typed events, Result-based requests, and
automatic reconnection.

### Connection lifecycle

```
1. 1. Connect    → Open WebSocket to signet
2. Authenticate → Send session token as first frame
3. Active     → Receive events, send requests
4. Reconnect  → Resume with sequence number for catch-up
```

The signet manages the connection state machine (connecting → authenticating →
active → draining → closed) and handles session resumption so your agent can
reconnect without missing events.

### Receiving messages

Messages from XMTP pass through the signet's view projection pipeline before
reaching your harness:

```
XMTP message → scope filter → content-type filter → visibility → projection → your agent
```

Your agent only sees messages that survive all stages. This is enforcement,
not filtering you could override — the raw messages never leave the signet.

### Sending messages

Your agent sends requests through the signet, which validates each one against
the active grant:

```
Your agent → signet validates grant → signet sends via XMTP → response
```

If the grant doesn't allow the action, the signet rejects it with a typed
error. The harness cannot bypass this.

## Scoping permissions

### Choosing a view mode

| Your agent needs to... | Use this view mode |
|------------------------|--------------------|
| See everything in the conversation | `full` |
| Only respond when explicitly asked | `reveal-only` |
| Work within a specific thread | `thread-only` |
| See content with PII stripped | `redacted` |
| Get conversation summaries | `summary-only` |

### Choosing grants

Start with the minimum. A summarization agent might need:

```
view:  summary-only
grant: messaging.send (to post summaries)
       egress.summarize (to use content for summaries)
```

A moderation agent might need:

```
view:  full
grant: group.removeMember
       group.updateMetadata
```

A personal assistant responding on your behalf:

```
view:  full
grant: messaging.send, messaging.reply, messaging.react
       tools.calendar, tools.search
       egress.forwardToProvider (to use an LLM)
```

### Content type allowlists

The effective allowlist is the intersection of:
1. **Baseline** — content types accepted in the XMTP spec
2. **Signet-level** — what the signet operator allows across all agents
3. **Per-agent** — what this specific agent's view includes

Your agent can never see content types that the signet doesn't allow, even
if the per-agent config includes them.

## Trust and verification

The signet doesn't magically make your agent trustworthy. It makes the system
**auditable and constrainable** — other participants can verify what your
agent is allowed to do, not just take its word for it.

### Trust tiers

| Tier | What it means |
|------|---------------|
| `unverified` | No verification performed |
| `source-verified` | Source code is publicly accessible and matches |
| `reproducibly-verified` | Build can be reproduced from source |
| `runtime-attested` | All verification checks pass |

### The 6 verification checks

The signet's verifier service runs these independently:

1. **Source available** — agent source code is publicly accessible
2. **Build provenance** — binary was built from the claimed source
3. **Release signing** — release artifacts are cryptographically signed
4. **Attestation signature** — attestation was signed by a valid key
5. **Attestation chain** — attestation correctly references its predecessor
6. **Schema compliance** — attestation conforms to the expected schema

Each check produces a verdict (pass/fail/skip) with evidence. The combined
result determines the trust tier.

## Broker vs. direct XMTP access

| Concern | Direct (CLI/SDK) | Through signet |
|---------|-------------------|----------------|
| Who holds the keys? | Your agent | The signet |
| Permission enforcement | Advisory (soft) | Structural (hard) |
| Group visibility | None — opaque | Attestations — inspectable |
| Content filtering | None | View projection pipeline |
| Key compromise blast radius | Full account | Session key only |
| Multi-agent isolation | Manual | Built-in |

The signet is the recommended path for any agent that participates in group
conversations or handles sensitive data. Direct SDK access is appropriate for
simple bots, testing, or situations where the agent IS the account owner.

## Deployment topologies

| Mode | Trust boundary | Best for |
|------|---------------|----------|
| **Local** | On your machine | Development, personal agents |
| **Self-hosted** | Your infrastructure | Production, privacy-sensitive |
| **Managed** | Third-party operator | Convenience, multi-tenant |

The same signet code runs in all modes. The difference is where plaintext
exists and who you trust. A local signet keeps everything on your machine.
A managed signet means plaintext exists at the operator's boundary.

## References

- `references/trust-model.md` — Verification checks in detail, trust tier
  mechanics, verifier service architecture
- `references/content-types.md` — Content type allowlist mechanics, baseline
  management, scoping rules
