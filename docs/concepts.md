# Core Concepts

This document describes the conceptual model behind xmtp-signet. For implementation details, see [architecture.md](architecture.md).

## Signet

The **signet** is the trusted runtime boundary that owns the real XMTP client.

It is responsible for:

- Holding the XMTP signer and identity material for one or more agent inboxes
- Maintaining installation continuity across sessions
- Persisting the encrypted XMTP database and its encryption keys
- Syncing, receiving, and storing conversation state
- Enforcing policy for views, grants, and message projection
- Issuing sessions to agent harnesses
- Publishing group-visible seals
- Maintaining per-agent isolation when serving multiple agents

The signet is infrastructure, not a participant. It does not appear in group membership. From the protocol's perspective, each agent is its own group member with its own XMTP inbox — the signet manages the signer for that inbox and operates its MLS state behind the scenes.

## View

A **view** is a policy-filtered projection of what an agent can see across one or more conversations.

Views control:

- **Visibility mode** — full, redacted, reveal-only, or thread-only in v0
- **Scope** — which groups and threads the agent can access
- **Content types** — an explicit allowlist of content types the agent receives

Content types not in the allowlist are held at the signet and never forwarded. The effective allowlist is the intersection of what the signet permits and what the agent's view configuration includes.

**Default-deny for unknown content types.** When a new content type is accepted into the XMTP spec, existing agents do not automatically start seeing it. The signet updates its baseline, but each agent's view must explicitly include the new type.

### View modes

| Mode          | What the agent sees                            |
| ------------- | ---------------------------------------------- |
| `full`        | All messages in scope                          |
| `thread-only` | Messages within specific threads               |
| `redacted`    | Messages with sensitive content removed        |
| `reveal-only` | Only messages explicitly revealed to the agent |
| `summary-only` | Signet-generated summaries (defined in schema, reserved — not implemented in v0) |

A view mode is a convenience label. The underlying view object (including content type allowlist) and grant remain explicit and authoritative.

## Grant

A **grant** is a structured description of what actions an agent is allowed to perform.

Grants are organized into categories:

### Messaging

- Send messages
- Reply in thread
- React
- Draft only (requires confirmation before posting)
- Post only with confirmation

### Group management

- Add members
- Remove members
- Update metadata
- Invite users
- Change agent policy

### Tool use

- Calendar access
- Payment actions
- External HTTP access
- Search and retrieval
- Custom application tools

### Egress and retention

- Store message excerpts
- Use content for memory
- Forward to model providers
- Quote revealed content
- Summarize hidden or revealed content

Views and grants are independently composable. An agent can have a `reveal-only` view paired with `send + react` capabilities, or a `full` view paired with `draft-only` capabilities.

## Seal

A **seal** is a signed assertion about an agent's current permissions, scope, and operating posture. Seals are published to the group as messages, making the agent's capabilities visible and verifiable by other participants.

Seals describe:

- Who owns the agent
- Which inbox the agent uses
- What the agent can see (view)
- What the agent can do (grant)
- How the agent handles egress and inference
- The hosting mode and trust posture
- What changed since the previous seal

### Materiality

Not every internal state change produces a group-visible seal. The system distinguishes **material changes** from **routine operations**.

**Material changes** that produce seals:

- View mode or scope changes
- Grant additions or removals
- Egress or inference policy changes
- Agent addition or revocation
- Ownership or hosting mode changes
- Verifier statement updates

**Routine operations** that remain silent:

- Session rotation within the same view and grant
- Heartbeat and liveness signals
- Internal signet housekeeping

This prevents the conversation timeline from becoming a compliance log while ensuring meaningful permission changes are always visible.

## Session

A **session** is the ephemeral authorization context between an agent harness and the signet. It is how the harness receives its active view and grant.

Sessions are:

- **Short-lived** — bounded duration, not permanent
- **Rotatable** — can be refreshed without disrupting the agent
- **Scoped** — bound to a specific view and grant
- **Revocable** — can be terminated immediately
- **Isolated** — one session per harness connection

When policy changes are material enough to require reauthorization, the session detects this and requires the harness to re-authenticate with the updated policy.

## Identity model

Each agent has its own XMTP inbox. The signet holds the signer for that inbox and operates its MLS state, but the group sees the agent as a distinct participant.

This means:

- No "ventriloquist" problem — each agent has its own identity, not a shared signet identity
- One signet can manage multiple agents, each in different groups
- Seals are about a specific agent, not the signet as a whole
- When multiple agents share a group, each has its own view, grant, and seal
- The signet maintains strict isolation between agents internally

## Action registry

An **action** is a single signet operation (send a message, list conversations, rotate a session) defined once and exposed across all transports. Each action is described by an `ActionSpec` that bundles:

- A name, description, and Zod input schema
- A transport-agnostic handler function
- Surface-specific metadata for CLI (command path, flags, output format) and MCP (tool name, annotations)

The **action registry** collects all defined actions. Transport adapters read the registry to generate their native representations — commander subcommands for CLI, MCP tool definitions for MCP, request routes for WebSocket. This eliminates per-transport boilerplate: adding a new operation means defining one `ActionSpec`.

## Admin authentication

The signet distinguishes two authentication domains:

- **Harness sessions** — how agent harnesses connect and prove authorization (session tokens, view/grant binding)
- **Admin authentication** — how operators and the CLI authenticate for management operations

Admin auth uses dedicated admin key pairs stored in the vault. The CLI signs JWTs with the admin key to authenticate against the signet's admin Unix socket. The `AdminAuthContext` on `HandlerContext` carries the verified admin identity, enabling fine-grained control over which admin operations are permitted.

Admin keys are peers to the root→operational→session key hierarchy, not derived from it. They serve a different purpose: authorizing management operations rather than signing messages.

## Direct mode

When no signet daemon is running, the CLI falls back to **direct mode** — accessing the encrypted vault and key material directly to perform operations like key generation, identity inspection, and configuration management. Direct mode detects whether a daemon is available and routes commands accordingly:

- **Daemon mode** — CLI sends JSON-RPC requests to the admin Unix socket
- **Direct mode** — CLI accesses the vault directly for key and config operations
- Operations that require a running signet (message sending, session management) are unavailable in direct mode

## MCP transport

The **MCP transport** exposes signet actions as Model Context Protocol tools, enabling LLM-driven agent harnesses to interact with the signet through the standard MCP tool-calling interface.

Each MCP session is scoped to a harness session — the session's grant determines which tools are visible. When a harness connects via MCP, `actionSpecToMcpTool` converts the permitted `ActionSpec` definitions into MCP tool registrations with JSON Schema input validation.

The MCP transport supports two modes:

- **Stdio** — launched as a subprocess, communicates over stdin/stdout (standard MCP pattern)
- **Embedded** — runs in-process for tighter integration

## Security boundary

The core security invariant: **the harness never touches raw keys, raw DB, or raw XMTP SDK.**

The signet enforces this by:

1. Managing all cryptographic material in a three-tier key hierarchy (root → operational → session)
2. Filtering messages through the view projection pipeline before they reach the harness
3. Validating all harness requests against the active grant
4. Publishing seals so other participants can inspect the agent's permissions

This is an application-layer boundary. The signet, as a full MLS group member, can decrypt all group messages. The security model is between the signet and the harness, not between the signet and the MLS group.

## Trust model

The signet does not magically make an agent trustworthy. It makes the system **auditable and constrainable** in a way today's pattern is not.

The verification service provides 6 discrete checks that move agents along a trust spectrum:

| Check              | What it verifies                                 |
| ------------------ | ------------------------------------------------ |
| Source available   | Agent source code is publicly accessible         |
| Build provenance   | Binary was built from the claimed source         |
| Release signing    | Release artifacts are cryptographically signed   |
| Seal signature     | Seal was signed by a valid key                   |
| Seal chain         | Seal references its predecessor correctly        |
| Schema compliance  | Seal conforms to the expected schema             |

These checks produce a trust tier
(`unverified` → `source-verified` → `reproducibly-verified` →
`runtime-attested`) that other participants can use to make informed decisions
about interacting with the agent.
