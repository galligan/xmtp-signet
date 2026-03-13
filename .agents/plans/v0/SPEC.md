# XMTP Agent Broker PRD

**Version:** 0.2.1
**Status:** Draft
**Updated:** 2026-03-12

## Summary

This document proposes an **agent broker** architecture for XMTP-based applications and agents.

The core idea is simple:

- A **broker** is the real XMTP client.
- The broker owns the raw XMTP signer, installation continuity, local encrypted database, and message sync.
- An **agent harness** never touches the raw XMTP client directly.
- Instead, the harness connects to the broker over a controlled interface and receives a filtered **view** of one or more conversations and a scoped **grant** of allowed actions.
- The permissions and scope of the view and grant are represented by group-visible **attestations**.

This model is designed to support agents in XMTP and Convos without pretending that a standard group member can somehow be cryptographically blind to ordinary group messages. It creates a practical, harness-agnostic security boundary that works with local brokers, self-hosted brokers, and managed broker deployments.

The proposal also outlines candidate XIP directions that could improve interoperability and richer client experiences over time, and describes a trust chain model that moves agent participation from opaque trust to inspectable trust.

## Motivation

There is growing interest in agents that participate in XMTP group chats, especially in apps such as Convos.

That interest is well-founded:

- Agents are a natural fit for group coordination, summarization, memory, retrieval, automation, and tool use.
- Group chat is a powerful environment for collaborative workflows and multi-party context.
- XMTP offers strong identity, messaging, and group primitives that make agent participation possible in a decentralized setting.

At the same time, the current agent shape is too blunt.

A typical setup today looks like this:

- An agent harness spins up a new account or inbox.
- It stores wallet material and database encryption keys locally.
- It runs the XMTP client directly.
- It joins a group as a normal member.

That pattern is convenient, but it has major problems:

- The harness effectively becomes the XMTP client.
- Any “read-only” or “limited” tool permissions are mostly advisory if the harness holds raw credentials.
- The blast radius is too large if keys, storage, logs, or tool integrations are compromised.
- There is little group-visible provenance around what an agent can actually do.
- There is no durable, shared language for agent capability posture inside a conversation.

We need a better boundary.

## From Opaque Trust to Inspectable Trust

Today, nobody should trust an XMTP agent just because it exists in a chat. An agent is basically just another XMTP inbox. XMTP gives you strong cryptographic identity primitives around inboxes and linked identities, signatures, and group-role permissions, but it does not currently tell other participants what software stack is behind that inbox, whether a broker is involved, or what capability boundary is actually being enforced.

The current state:

- An agent joins a group.
- You know it is some inbox.
- You do not know what code is running behind it.
- You do not know whether it has raw credentials.
- You do not know whether its claimed limits are real.

This proposal does not solve trust by decree. It moves us from **opaque trust** to **inspectable trust**.

Concretely, that means a brokered agent can publish signed, group-visible attestations describing its current permissions, hosting mode, and scope, and agent-authored messages can reference the attestation they were produced under.

That still does not prove the operator is honest. But it gives the group something cryptographic and inspectable to verify, which is strictly better than the current state where agents can make claims and nobody can tell what is actually behind them.

The important honesty clause: a broker does not magically make an agent trustworthy. It makes the system **auditable and constrainable** in a way today’s pattern is not. That is the difference.

## Ground Setting

### What we are proposing

We are proposing an **application-layer brokered model** for agent access to XMTP conversations.

In this model:

- The broker is the real XMTP participant runtime.
- The agent consumes a derived and policy-filtered interface.
- Permissions are enforced at the broker boundary.
- Group-visible attestation messages communicate the current capability state of an agent.
- The same conceptual model works across local, self-hosted, and managed deployments.

### What we are not proposing

We are **not** proposing that a standard XMTP group member can be given a weaker token and thereby become selectively unable to decrypt ordinary group messages.

We are **not** proposing a centralized authority that all agent permissions must flow through.

We are **not** claiming that a hosted broker preserves the same trust boundary as a local broker.

We are **not** trying to fully solve cross-session or cross-group memory leakage inside the agent model itself. The immediate goal is to create a better boundary for raw message access and action authority.

### MLS and the cryptographic reality

XMTP v3 uses the Messaging Layer Security (MLS) protocol for group encryption. The broker, as the real XMTP client, is a full MLS group member. It holds the complete epoch key schedule and can decrypt all group messages it receives. The view model described in this proposal is purely application-layer filtering on top of MLS. The broker always has access to the full ciphertext-to-plaintext path for its groups.

This is by design. The security boundary this proposal creates is between the broker and the agent harness, not between the broker and the MLS group. The broker is trusted to enforce policy on the derived view; MLS is not being extended or modified.

### Design truth statements

Several truths should remain explicit throughout the design:

- If the harness holds the raw XMTP signer and raw DB access, token-based restrictions are largely cosmetic.
- If the broker is remote, plaintext exists at the remote broker boundary for anything the broker is allowed to process.
- If an agent is allowed to send content to an external LLM provider, privacy guarantees are weaker than pure end-to-end delivery between human clients.
- A clean user experience should not rely on magical hidden guarantees that the system does not actually provide.
- An inbox alone can prove identity association and signatures. It cannot prove “I am definitely running behind a real broker with these exact internal controls.”

## Product Goals

### Primary goals

- Enable safe and ergonomic agent participation in XMTP and Convos conversations.
- Make permissions meaningful by enforcing them below the harness layer.
- Keep the capabilities model agnostic to the agent framework or harness.
- Create group-visible provenance for agent permissions and permission changes.
- Support both local and hosted deployment topologies.
- Preserve a clean path toward standardization through future XIPs.

### Secondary goals

- Allow flexible message visibility modes, including reveal-oriented flows.
- Support multiple transport surfaces such as WebSocket, MCP, HTTP, CLI, and SDK adapters.
- Make it easy for users to self-host or one-click deploy their own broker.
- Give apps like Convos rich UX affordances without requiring immediate protocol changes.
- Provide a near-term deployable verification path for broker trust.

## Non-Goals

- Full protocol-level selective message visibility for standard group members.
- Hiding metadata from infrastructure operators beyond what XMTP already protects.
- Preventing an agent from storing or inferring information it has already been shown.
- Solving every governance question about group approval and social policy in v1.

## Core Concepts

### Broker

The **broker** is the trusted runtime boundary that owns the real XMTP client.

Responsibilities:

- Hold the XMTP signer or equivalent identity material for one or more agent inboxes.
- Maintain installation continuity.
- Persist the raw XMTP database and its encryption keys.
- Sync, receive, and store the real conversation state.
- Enforce policy for views, grants, and message projection.
- Issue sessions to agent harnesses.
- Publish group-visible capability attestations.
- Manage per-agent isolation when serving multiple agents.

The term “broker” is preferred over “gateway” to avoid confusion with XMTP Gateway Service and other gateway terminology in the ecosystem.

### Identity Model

Each agent has its own XMTP inbox. The broker holds the signer for that inbox and operates its MLS state, but from the protocol’s perspective, the agent is the group member.

This means:

- The group sees each agent as a distinct participant with its own inbox identity.
- Attestations are about a specific agent, not about the broker as a whole.
- One broker can manage multiple agent inboxes, each joining different groups independently.
- There is no “ventriloquist” problem where one broker identity speaks as multiple agents.
- The broker is infrastructure, not a participant. It does not appear in group membership.

When a single broker serves multiple agents in the same group, each agent has its own inbox, its own attestation, its own view, and its own grant. The broker maintains strict isolation between agents internally — Agent A’s view must not leak into Agent B’s derived state.

### View

A **view** is a policy-filtered description of what an agent can see across one or more conversations.

A view may specify:

- Full visibility over a conversation or thread.
- Redacted visibility.
- Reveal-only visibility.
- Thread-scoped visibility.
- Summary-only visibility.

A view also specifies allowed **content types** via an explicit allowlist. Content types not in the allowlist are held at the broker and not forwarded to the agent.

Content type allowlists follow three tiers:

- **Baseline allowlist:** Content types that have passed through the XIP process and are part of the accepted XMTP spec. These are allowed by default.
- **Broker-level configuration:** The broker operator can expand or restrict beyond the baseline across all agents the broker manages.
- **Per-agent view configuration:** The owner can further scope what a specific agent sees within what the broker allows.

The effective allowlist for any given agent is the intersection of what the broker permits and what the agent’s view config includes.

**Default-deny for unknown content types.** If a content type is not in the effective allowlist, it does not reach the agent. When a new XIP content type is accepted and the baseline list updates, existing agents do not automatically start seeing it. The broker updates its baseline, but each agent’s view must explicitly include the new type.

A view is not the real XMTP message state. It is a derived projection enforced by the broker.

### Grant

A **grant** is a structured description of what actions an agent is allowed to perform.

Grant categories:

#### Messaging capabilities

- Send messages.
- Reply in thread.
- React.
- Draft only.
- Post only with confirmation.

#### Group management capabilities

- Add members.
- Remove members.
- Update metadata.
- Invite users.
- Change agent policy.

#### Tool capabilities

- Calendar access.
- Payment actions.
- External HTTP access.
- Search/retrieval.
- Custom application tools.

#### Retention and egress capabilities

- Store message excerpts.
- Use content for memory.
- Forward to model providers.
- Quote revealed content.
- Summarize hidden or revealed content.

A view and a grant are independently composable. An agent can have a `reveal-only` view paired with `send + react` capabilities, or a `full` view paired with `draft-only` capabilities, without needing named modes for every combination.

### View Modes

Suggested initial view modes as convenience labels:

- `full`
- `thread-only`
- `redacted`
- `reveal-only`
- `summary-only`

A view mode is only a convenience label. The underlying view object (including the content type allowlist) and grant object should remain explicit and authoritative.

### Attestation

An **attestation** is a signed assertion about an agent’s current permissions, scope, and operating posture.

Attestations are meant to be visible to the group and updated whenever permissions change materially.

Attestations establish shared understanding of:

- Who owns the agent.
- Which inbox the agent uses.
- What the agent can see (view).
- What the agent can do (grant).
- How the agent handles egress and inference.
- Whether content is reveal-only or broader.
- The hosting mode and trust posture.
- What changed since the previous state.

#### Attestation noise and materiality

Not every internal state change should produce a group-visible attestation. The system should distinguish **material changes** from **routine operations**.

Material changes that produce group-visible attestations:

- View mode or scope changes.
- Grant additions or removals.
- Egress or inference policy changes.
- Agent addition or revocation.
- Ownership or hosting mode changes.
- Verifier statement updates.

Routine operations that remain silent:

- Session rotation within the same view and grant.
- Heartbeat / liveness signals.
- Internal broker housekeeping.

This prevents the conversation timeline from becoming a compliance log while ensuring that meaningful permission changes are always visible.

### Session

A **session** is the ephemeral authorization context between an agent harness and the broker.

A session is how the harness receives its active view and grant.

Sessions should be:

- Short-lived.
- Rotatable.
- Scoped.
- Revocable.
- Bound to a specific view and grant.

#### Session and view/grant binding

View and grant updates that do not change the security boundary can be applied within an existing session without requiring reconnection. Examples: adjusting a thread scope, adding a new content type to the allowlist, or enabling a reaction capability.

Changes that materially expand the security boundary require session reauthorization. Examples: upgrading from `reveal-only` to `full` visibility, adding egress permissions, or granting group management capabilities. The broker should terminate the current session and require the harness to establish a new one under the updated policy.

This prevents excessive reconnection churn while ensuring that privilege escalation always involves a clean authorization step.

## Users and Stakeholders

### End users

People who want to add agents to their private or group conversations without surrendering raw account access to the agent harness.

### Group members

People sharing a conversation with an agent who need visibility into what that agent can currently do.

### App developers

Teams building XMTP or Convos clients that want first-class agent support with clear permission UX.

### Agent developers

People building harnesses, tools, and integrations who need a stable, framework-agnostic interface.

### Infrastructure operators

People who want to self-host or provide managed broker services.

## Problem Statement

Today, the easiest way to run an XMTP agent is to let the harness run the XMTP client directly.

That creates several structural problems:

- The harness can often bypass app-level permissions by calling the SDK or CLI directly.
- There is no clean separation between the real client and the agent’s policy view.
- Hosted deployments become hard to reason about because the host is effectively the agent endpoint anyway.
- Users and group members do not have a durable, shared language for understanding current capability state.
- Different apps and agent frameworks are likely to reinvent incompatible patterns.

The system needs a boundary that is real, visible, and portable.

## Proposed Solution

### High-level architecture

The proposed architecture separates the system into three layers:

#### Raw plane

The raw plane contains the real XMTP client and raw conversation state.

Owned by the broker:

- Signer material for agent inboxes.
- Installation continuity.
- Raw message retrieval and sync.
- Raw local database.
- DB encryption keys.

#### Policy plane

The policy plane determines what an agent is allowed to see and do.

It includes:

- View definitions (visibility scope and content type allowlists).
- Grant definitions (action permissions).
- Reveal state.
- Group policy state.
- Attestations.
- Revocations.

#### Derived plane

The derived plane is what the agent actually consumes.

This may be:

- A filtered event stream.
- A derived encrypted cache.
- A session-bound local store.
- A transformed API surface.
- A combination of the above.

### Core rule

The harness never touches the raw plane.

The broker is the only component allowed to operate the real XMTP client.

### Harness-agnostic interface

The broker should expose a canonical interface that can be adapted to:

- WebSocket
- HTTP
- MCP
- CLI bindings
- OpenClaw channel adapters
- AI SDK adapters
- Claude Agent SDK adapters
- OpenAI agent adapters

The system should define one capability model and multiple connection adapters, rather than one permission system per harness.

## Egress and Inference Disclosure

When an agent sends conversation content to an external LLM provider, the privacy story changes fundamentally. This is arguably the single most consequential thing a group member would want to know about an agent.

Egress and inference posture must be declared as structured, first-class fields in the attestation — not buried in a generic policy blob.

### Required egress fields

- `inferenceMode` — `local` | `external` | `hybrid`
- `inferenceProviders` — A list of providers the agent may use, e.g. `["anthropic", "openai"]`. Empty for purely local inference.
- `contentEgressScope` — What content leaves the broker boundary: `full-messages` | `summaries-only` | `tool-calls-only` | `none`
- `retentionAtProvider` — `none` | `session` | `persistent` | `unknown`

These fields are **required** in every attestation. If the value cannot be determined, the field must be set to `unknown` rather than omitted. Silent omission is not allowed. Every attestation takes an explicit position, even if that position is “I don’t know.”

### Envelope declaration

For agent frameworks that dynamically switch inference providers (such as OpenClaw), the attestation should declare the **envelope** of possible providers, not the instantaneous state. If the agent may route to Anthropic, OpenAI, or a local model depending on the query, the attestation declares all three and sets `inferenceMode` to `hybrid`.

Overstating the envelope is acceptable. Understating it is not.

### Verification and honesty

In v1, these fields are self-reported by the broker. An unverified broker claiming `inferenceMode: local` gets treated with the same skepticism as any other unverified claim. A source-verified or runtime-attested broker making that claim is more credible. The schema does not solve trust — it gives trust something structured to attach to.

## Attestation Model

### Why attestations matter

Attestations make agent posture legible to the conversation itself.

Without attestations, permissions live only in the owner’s client or broker config. That is not enough for a multi-party environment.

### Attestation signing in v1

In v1, the broker signs attestations using the agent’s inbox key (which the broker holds). The attestation includes the `ownerInboxId` field, which creates a social accountability link — the group can see who is responsible for the agent — even though the owner is not cryptographically co-signing every update.

Clients verify the signature against the agent’s inbox, confirming the attestation came from the entity that controls that agent.

In future versions, optional owner co-signing could be added for high-stakes permission changes (such as upgrading from `reveal-only` to `full` visibility), while keeping routine attestations broker-signed only.

### Attestation lifecycle

An attestation should be published when a material change occurs:

- An agent is added.
- Permissions are first granted.
- View or grant changes.
- Egress or inference policy changes.
- The agent is revoked.
- The ownership or hosting mode changes.
- A verifier statement is updated.

### Suggested attestation fields

- `attestationId`
- `previousAttestationId`
- `agentInboxId`
- `ownerInboxId`
- `groupId`
- `threadScope`
- `viewMode`
- `contentTypes`
- `grantedOps`
- `toolScopes`
- `inferenceMode`
- `inferenceProviders`
- `contentEgressScope`
- `retentionAtProvider`
- `hostingMode`
- `trustTier`
- `buildProvenanceRef` (optional, populated when available)
- `verifierStatementRef` (optional, populated when available)
- `sessionKeyFingerprint`
- `policyHash`
- `heartbeatInterval`
- `issuedAt`
- `expiresAt`
- `revocationRules`
- `issuer`

### Message provenance

Agent-authored messages should reference the attestation under which they were produced.

This gives clients the ability to render:

- The current capability posture.
- Whether a message was generated under different permissions than the current state.
- Whether permissions changed mid-conversation.

### Trust model for attestations

The system should not rely on self-attestation from the agent alone.

The more trustworthy path is:

- The broker signs the attestation with the agent’s inbox key.
- The attestation is posted into the group.
- Agent messages reference the current attestation.
- Clients compare references over time.
- Verifier statements (when available) add external validation.

## Trust Chain Model

The trust model for brokers is built as a chain of four independent layers. Each layer adds assurance, but none alone is sufficient.

### Layer 1: XMTP Identity

What XMTP already provides. Proves which inbox is speaking, with cryptographic identity association and signatures. This tells you **who**, but not what software or controls are behind that identity.

### Layer 2: Build Provenance

What the broker project publishes. Establishes that a specific artifact was built from a specific source by a specific pipeline. Relevant evidence includes: repo, commit SHA, build workflow, artifact digest, SBOM, signing identity, and transparency log entries.

Tools in this layer include SLSA provenance, Sigstore signing and transparency logs, and GitHub artifact attestations.

Open source plus build provenance gets you to: “this artifact likely came from that source/build pipeline.”

### Layer 3: Runtime Attestation

What the live broker instance proves. Establishes that a specific measured workload is actually running in the deployment environment. This is where enclave-style attestation (such as AWS Nitro Enclaves or other TEE platforms) fits for hosted deployments.

Runtime attestation gets you to: “this live hosted broker is likely running the artifact it claims to be running.”

The design should be **TEE-agnostic and verifier-agnostic** — AWS Nitro today, other attested runtimes tomorrow, or purely source/build-verified self-hosting for users who do not want enclave dependencies.

### Layer 4: Capability Attestation

What gets posted into the group. Describes what this broker claims the agent can do right now. This is the app/XIP layer — the view, the grant, the hosting mode, the egress posture.

This layer becomes far more credible when it chains back to the first three layers.

### Trust Tiers

The trust chain maps to three practical tiers that clients can render:

#### Tier 1 — Source-verified

- Open source broker implementation.
- Signed release.
- Build provenance available and verifiable.

#### Tier 2 — Reproducibly verified

- All of Tier 1.
- Independent parties can reproduce the artifact bit-for-bit from source.

#### Tier 3 — Runtime-attested

- All of Tier 2.
- Hosted runtime proves measurement via remote attestation.
- Secrets are released only to approved measurements.

The group-visible attestation includes a `trustTier` field reflecting the highest tier the broker can currently demonstrate.

## Broker Verification

### Near-term: Reference Verifier

To provide a fast path to verification without waiting for the full trust chain to mature, the system should ship an open source **reference verifier** — a lightweight service deployable to Cloudflare Workers, Railway, or similar platforms.

The reference verifier:

- Accepts a verification request containing the broker inbox ID, artifact digest, and build provenance bundle.
- Checks the provenance against a known set of published releases (GitHub artifact attestations, Sigstore transparency log entries).
- Returns a signed verification statement bound to the broker’s inbox, artifact digest, and an expiry.

The verifier identity is just an XMTP inbox. The verification statement is a signed message (or structured content type). This means the protocol surface is the same whether the verifier is a reference instance, a community-run deployment, or eventually a node operator sidecar. The decentralization path is baked in from day one because there is no privileged API endpoint — just inboxes that issue statements and clients that decide which issuers to trust.

### Verifier-over-XMTP flow

1. Broker inbox opens a DM with verifier inbox.
1. Broker sends a verification request containing: broker inbox identity, challenge nonce, artifact digest, build provenance bundle, optional runtime attestation evidence, requested verification class.
1. Verifier checks policy and evidence.
1. Verifier replies over XMTP with a signed verification statement.
1. Broker references that statement in its group-visible capability attestation via the `verifierStatementRef` field.
1. Clients validate: the verifier issuer, the signature, expiry, evidence class, and whether subsequent agent messages still point to a current statement.

### Multiple issuers

The system should support multiple verifier issuers. Apps, auditors, node operators, XMTP Labs, third parties, and self-run verifiers can all participate. Clients and groups choose which issuers they trust. There should be no single central authority blessing all brokers.

### XMTP node operators

XMTP node operators could run verifier services alongside their nodes in the future, but the node software itself should not be required to become the verifier layer. This preserves decentralization of issuers without bloating the network’s base responsibilities. A later XIP could explore whether the node layer should participate more directly.

## Reveal and Selective Visibility

### Important distinction

This proposal does not assume protocol-level selective decryptability for normal XMTP group messages.

Instead, it uses **broker-enforced selective disclosure**.

### Practical reveal model

The broker receives and stores the real conversation state.

For each incoming message, the broker decides what to project into the view:

- Full plaintext.
- Redacted content.
- Hidden placeholder.
- Summary.
- Nothing.

### Reveal behaviors

Suggested reveal patterns:

- Reveal per message.
- Reveal per thread.
- Temporary reveal mode for a time window.
- Reveal by content type.
- Reveal by sender or role.

### Group-visible policy

Reveal behavior should be understandable in the client UX.

For example, Convos could render:

- Hidden from assistant.
- Revealed to assistant.
- Reveal this message.
- Reveal this thread.
- Pause assistant visibility.

### Why this matters

This preserves a meaningful distinction between:

- The real XMTP message state.
- The materialized agent view.

That distinction is what makes broker-enforced permissions real.

## Liveness and Graceful Degradation

The broker-mediated model adds a mandatory dependency: if the broker goes down, the agent goes completely silent. From the group’s perspective, a crashed broker is indistinguishable from a healthy agent that is choosing not to respond. The system should address this.

### Heartbeat and staleness

The attestation includes a `heartbeatInterval` field indicating the expected liveness cadence. Clients should render an “agent unreachable” or “last active N minutes ago” indicator when the interval is exceeded. This does not require noisy group-visible messages — it can be inferred from session keepalives or lightweight structured signals.

### Broker recovery: inbound messages

Messages sent by the group while the broker was down should still be delivered to the agent on recovery. The agent needs that context to understand what happened during the outage. However, the broker must tag these messages as **historical** — they carry their original timestamps, but the broker signals to the agent that they are not fresh messages to act on. The agent gets context, not action triggers.

### Broker recovery: outbound messages

Outbound agent actions that were queued or implied during downtime should be subject to a **configurable expiry window**. If the broker recovers within that window, queued actions can proceed. Beyond the window, they expire silently. This prevents stale responses to questions asked hours earlier.

### Client-side rendering

When the broker recovers, the client can show a notice such as “agent back online, caught up through [timestamp]” to indicate that the agent has resynced but may have missed real-time participation during the outage.

## Revocation

Revocation should be **immediate, visible, and fail-closed**. If there is any ambiguity about whether an agent is still authorized, the answer is no.

### Normal revocation

The owner instructs the broker to revoke the agent. The broker immediately terminates the agent’s session, posts a revocation attestation to the group, and stops projecting any view to that agent.

### Owner loses access

If the owner’s device is lost or the owner leaves the group, two safety valves apply:

- **Mandatory expiration:** Attestations must have an `expiresAt` field. A broker with no owner contact eventually stops being authorized.
- **Group admin override:** Group admins can remove the agent’s inbox from the group at the XMTP group permissions level, which effectively kills access regardless of what the broker thinks.

### Session expiry without rotation

If a session expires and the harness does not re-authenticate, the broker automatically stops projecting the view. No silent continuation on stale credentials. The broker posts a session-expired attestation so the group knows the agent is no longer active under valid authorization.

### In-flight messages during revocation

If the agent has a message in transit when revocation hits, the broker drops it. A message that arrives at the broker after the revocation attestation was posted should never reach the group. Better to lose a message than to have an agent act after its permissions were pulled.

## Threat Model

The broker architecture concentrates trust in the broker and its host. The following threat profiles map attacker types to what they gain across deployment modes.

### Compromised harness

What they gain: nothing beyond the current view and grant. The harness has no raw signer, no DB encryption key, no direct XMTP SDK access. The attacker can abuse the agent’s currently granted actions and read whatever the current view exposes, but cannot escalate beyond the session’s permissions.

This is the scenario the architecture is specifically designed to contain, and represents a major improvement over the current model where a compromised harness has full client access.

### Compromised broker host (local)

What they gain: access to operational keys and the raw DB, but not the root signing key if it is stored in the Secure Enclave. The attacker can read raw messages and abuse the operational key for routine signing, but cannot perform privilege escalation (which requires biometric authentication on the root key) and cannot extract the root key from hardware.

On platforms without hardware-backed key storage, a compromised local machine means full access to the raw plane including all key material.

Mitigation includes hardware-backed key storage (Secure Enclave, TPM), standard local security hygiene, and biometric gating on privilege escalation. The broker does not make a compromised machine safer — but hardware-bound keys significantly limit what an attacker can do even with process-level access.

### Compromised broker host (self-hosted / managed)

What they gain: full raw message access for all agents the broker manages, all signer material, and the ability to forge attestations. The hosted environment is the real client boundary, and compromise of it is equivalent to owning every agent on that broker.

Mitigations: short-lived sessions limit exposure window, mandatory attestation expiry forces periodic renewal, runtime attestation (Tier 3) can detect environment tampering, and the broker’s attestation history creates a forensic trail.

### Malicious operator (managed deployment)

What they gain: the same access as a compromised host, but with the added ability to operate covertly over time. A malicious managed broker operator can silently exfiltrate messages, forge attestations, and impersonate agents.

Mitigations: the `hostingMode` field in attestations discloses managed deployment, allowing clients to render appropriate trust indicators. Runtime attestation (Tier 3) with TEE-backed key release is the strongest counter. Verifier statements from independent issuers provide a cross-check. But fundamentally, a managed broker requires trust in the operator — the system should be honest about that.

### Network adversary

What they gain: limited value. XMTP messages are encrypted in transit via MLS. The attacker cannot read message contents. They may observe metadata (who is communicating, when, message sizes) to the extent XMTP’s transport layer exposes it, but the broker architecture does not change this posture relative to the current model.

## Governance and Group Policy

### Initial ownership model (v1)

For v1, an agent is owned and configured by one group member.

That owner can:

- Add the agent.
- Configure the view and grant.
- Rotate permissions.
- Revoke access.

### Group visibility

Even in the owner-driven model, the resulting permissions are visible to the group via attestations. Group members can inspect what an agent can see and do at any time.

### Power asymmetry in v1

The v1 model creates a known power asymmetry. If Alice adds an agent with `full` visibility, Bob can see that via the attestation, but he has no direct mechanism to override or restrict the agent’s permissions — his recourse is limited to leaving the group or asking Alice to change the configuration.

This is an accepted limitation of v1. The attestation model makes the situation transparent, which is a meaningful improvement over the current state where Bob has no visibility at all.

### Future group governance

Over time, clients and standards could support richer governance patterns that address this asymmetry:

- Group-level caps on maximum permissions (e.g. “no agent in this group may exceed reveal-only visibility”).
- Approval thresholds for risky capabilities.
- Admin-only control of agent policy.
- Automatic revocation if owner leaves or is removed.
- Per-member objection mechanisms.

## Client Experience

### Convos as a rich reference client

Convos is especially well-positioned to make this model understandable because it already leans into per-conversation identity, privacy-forward UX, and explicit assistant behavior.

Possible Convos additions:

- Agent creation and connection flow from within a conversation.
- Visual view mode and grant badges.
- Trust tier indicators.
- Permission editing UI.
- Reveal toggles on messages and threads.
- Timeline cards for attestation changes (material changes only).
- Agent ownership labeling.
- Hosting mode labeling.
- Inference and egress disclosure (e.g. “processes locally” or “sends to Anthropic, session only”).
- Confirmation flows for risky actions.
- Explainability UI for why an agent did or did not see a message.
- Agent offline / staleness indicators.

### UX principles

- Make capability posture visible without being noisy.
- Default to understandable safety labels.
- Keep message timelines coherent.
- Avoid creating excessive side-chat tax unless the user explicitly chooses that mode.
- Show provenance on agent actions.
- Distinguish material permission changes from routine operations in the timeline.

### Trust tier rendering

Clients should render trust posture in a way that is accurate but not alarmist:

- **Unverified** — no verifier statement, self-asserted only.
- **Source-verified** — build provenance verified by a recognized issuer.
- **Reproducibly verified** — independent reproduction confirmed.
- **Runtime-attested** — live environment measurement verified.

Additionally:

- **Local** — broker runs on the user’s machine.
- **Self-hosted** — broker runs on user-controlled infrastructure.
- **Managed** — broker hosted by a third party.

These two dimensions (trust tier and hosting mode) should be shown together so users can make informed decisions.

### Side-chat and side-room support

Even if reveal-in-place is the main UX, clients should still support side-room patterns for higher-risk or higher-privacy tasks.

Useful variants:

- Task-specific side rooms.
- Temporary assistant workrooms.
- Private reveal rooms for selected participants.

## Deployment Model

### Local broker

A local broker runs on the user’s machine.

Benefits:

- Strongest practical trust boundary.
- Lowest third-party exposure.
- Natural fit for users already running local agents.

Trade-offs:

- Requires an always-on machine for long-lived agents.
- More setup friction.
- Local networking and process management complexity.

### Self-hosted broker

A self-hosted broker runs on a machine or service the user controls.

Examples: home server, private VM, personal cloud deployment.

Benefits:

- Persistent uptime.
- Better privacy posture than a fully managed service.
- Operational flexibility.

Trade-offs:

- More operational burden.
- Trust still moves to the hosted environment.

### Managed broker

A managed broker is hosted by a third party.

Benefits:

- Lowest setup friction.
- Makes the model accessible to users without an always-on machine.
- Good default for agents that need continuous operation.

Trade-offs:

- The managed broker becomes the real client boundary.
- Plaintext exists where the broker processes it.
- The trust boundary is weaker than local or self-hosted deployments.

### Product truth

All deployment modes share:

- The same broker protocol.
- The same view and grant model.
- The same attestation model.
- The same client UX semantics.

They do not share the same trust boundary.

That difference should be clearly disclosed.

Managed broker deployments have real operational costs — compute, storage, bandwidth. The protocol should support lightweight and hibernatable broker modes to keep deployment sustainable.

## Hosting and Deployment Strategy

### Spec-first approach

The system should be defined as an open specification first, with multiple reference deployments.

Recommended outputs:

- Broker protocol spec.
- View, grant, and session spec.
- Attestation schema.
- Reference verifier implementation (deployable to Cloudflare Workers or Railway).
- Broker reference implementations.
- One-click deployment templates.

### Recommended deployment profiles

#### Desktop local profile

- Runs as a local service.
- Connects over localhost WebSocket, Unix socket, or local MCP.
- Best for privacy-sensitive users and local agent workflows.

#### Self-hosted container profile

- Runs in a stateful Linux container or VM.
- Uses persistent disk.
- Good fit for Fly, Railway, VPS, or home-server deployment.

#### Cloudflare hybrid profile

- Cloudflare handles control-plane tasks.
- A stateful raw broker runs elsewhere.
- Good fit for global session management, fanout, and attestation coordination.

### Platform considerations

#### Fly.io

A strong candidate for stateful self-hosted or semi-managed broker deployment because it maps well to persistent container workloads.

#### Railway

Also a strong candidate for persistent broker deployment with good ergonomics for rapid setup.

#### Cloudflare

Best suited to control-plane roles, hybrid deployment patterns, and hosting the reference verifier.

### One-click deployment

A one-click deployment experience should:

- Generate broker secrets inside the target environment.
- Avoid showing long-lived secrets back to the user in plaintext when possible.
- Support user-controlled recovery and rotation.
- Publish broker identity and attestation fingerprints.
- Make the hosting mode visible to the client.

### Honest security posture for hosted deployment

A hosted deployment may keep secrets from leaving the environment in plaintext to the user, but that is not equivalent to a cryptographic guarantee that the hosting platform or deployer can never access them.

The product language should reflect that honestly.

## Transport and Interface Design

### Primary transport

WebSocket is the most natural primary transport for live agent interaction.

Reasons:

- Real-time event streaming.
- Bi-directional messaging.
- Natural fit for session-oriented connections.
- Good substrate for harness adapters.

### Additional adapters

The broker should also support:

- MCP adapter
- HTTP API
- CLI client
- SDK helper libraries
- OpenClaw channel adapter

### Canonical broker events

Suggested event types:

- `session.started`
- `session.expired`
- `session.reauthorization_required`
- `attestation.updated`
- `view.updated`
- `grant.updated`
- `message.visible`
- `message.visible.historical`
- `message.hidden`
- `message.revealed`
- `tool.allowed`
- `tool.denied`
- `action.confirmation_required`
- `agent.revoked`
- `broker.recovery.complete`

## Security and Privacy Model

### Trusted computing base

In this architecture, the broker and its host form the trusted computing base for the raw XMTP view.

That is true whether the broker is local or hosted.

### Security goals

- Keep raw XMTP credentials out of the harness.
- Make permissions meaningful through enforced mediation.
- Minimize blast radius through short-lived sessions and explicit scopes.
- Make agent posture visible to conversation participants.
- Reduce accidental overexposure to tools and models.
- Ensure revocation is immediate, visible, and fail-closed.

### Security limitations

- A compromised broker can expose raw content.
- A malicious host or operator may still exfiltrate data in hosted environments.
- An agent can still remember or infer content it has already seen.
- Egress to an LLM provider weakens privacy relative to pure client-to-client messaging.
- Attestation fields beyond the trust chain are self-reported in v1.

### Hard requirements

- No direct harness access to raw keys.
- No direct harness access to raw DB files.
- No unsupported side-channel access to the raw plane.
- Signing keys stored in hardware-backed storage where available (Secure Enclave, TEE).
- Privilege escalation requires root key authorization (biometric or equivalent).
- Clear session expiration and rotation.
- Clear revocation flow with fail-closed behavior.
- Mandatory `expiresAt` on all attestations.

## Key Management and Hardware Binding

The PRD states that the broker “holds the signer” for agent inboxes. This section specifies *how* that signer material should be managed, with a strong preference for hardware-backed key storage that prevents extraction even by the broker process itself.

### Design principle

The broker should be able to **invoke** signing operations without being able to **extract** the signing key. This is the difference between “the broker holds the key” and “the broker can use the key through hardware-enforced mediation.” The latter is materially stronger.

### Inspiration

Projects such as keypo-cli demonstrate that Mac Secure Enclave-backed P-256 key management for AI agents is practical and shippable today. The architectural pattern — keys generated inside hardware, never exportable, with policy-gated access (open, passcode, biometric) and a vault system for encrypted secret storage — is directly applicable to the broker’s key management needs.

However, for supply chain integrity, the broker should implement its own purpose-built key management layer rather than taking a dependency on a third-party tool. The core security boundary of the broker should not depend on external packages whose maintenance, auditability, or future direction is outside the project’s control. The keypo-cli architecture should be treated as a reference design, not a runtime dependency.

### Recommended key hierarchy

The broker should maintain a three-tier derived key hierarchy:

#### Root key

- Generated inside the Secure Enclave (local) or TEE (hosted).
- Protected by biometric authentication (Touch ID) or equivalent strong authentication.
- Non-exportable by hardware design.
- Used for: initial agent inbox creation, privilege escalation authorization, key rotation, and recovery flows.
- This is the agent’s true identity anchor.

#### Operational key

- Derived from the root key.
- Protected by `passcode` or `open` policy depending on deployment mode.
- Used for: routine message signing, attestation publishing, session issuance, and day-to-day broker operations.
- Does not require biometric authentication per operation, allowing the broker to function autonomously for routine tasks.

#### Session keys

- Ephemeral, scoped to a specific session and grant.
- Issued to the agent harness.
- Short-lived and revocable.
- Cannot escalate to operational-level or root-level operations.
- This is what the harness actually holds.

### Privilege escalation and biometric gating

Routine broker operations — sending messages, publishing routine attestations, managing sessions — should flow through the operational key without requiring per-operation authentication. This allows agents to function autonomously within their granted permissions.

Operations that cross a privilege threshold should require root key authorization, which means biometric (or equivalent) authentication:

- Upgrading a view from `reveal-only` to `full` visibility.
- Adding egress permissions or new inference providers.
- Granting group management capabilities.
- Creating new agent inboxes.
- Performing key rotation.
- Any grant escalation beyond the current session’s scope.

This maps directly to the session reauthorization boundary defined in the Session section: non-material operations flow through the session, material privilege escalations require a clean authorization step backed by the root key.

### Coordinating agent pattern

A broker with root key access can act as a key authority for its managed agents. A coordinating agent — itself operating under a specific view and grant — could be authorized to create new agent inboxes on the fly, each with their own derived operational key, each scoped to specific grants.

Those downstream agents can operate autonomously within their scoped permissions, but they can never reach back up to the root key without a biometric check from the human owner. This enables patterns like:

- A coordinating agent that spins up task-specific agents for a conversation.
- Each task agent gets a scoped grant and derived key.
- If any task agent needs to exceed its granted scope, the request bubbles up to the coordinating agent, which in turn requires root key authorization from the owner.

### Encrypted secret storage

Beyond signing keys, brokers need to manage other secrets: database encryption keys, API credentials for inference providers, webhook tokens, and configuration secrets.

These should be stored in an encrypted vault backed by the same hardware key hierarchy. Secrets are encrypted at rest using enclave-backed keys and injected into processes as environment variables at runtime — never written to disk in plaintext, never stored in `.env` files, and never visible in shell history or process listings.

### Local broker key management

For local brokers on macOS with Apple Silicon:

- Root key lives in the Secure Enclave, protected by biometric policy.
- Operational and session keys are derived and managed in memory or in the encrypted vault.
- The user can set up a broker with a single biometric authentication.
- Day-to-day operation does not require repeated biometric prompts.
- The key literally cannot be extracted — not by the agent, not by the harness, not by malware, and not by the broker process itself.

For local brokers on other platforms, the implementation should use the best available hardware-backed key storage (TPM, platform keychain with hardware binding, etc.) and degrade gracefully with clear labeling of the actual security posture.

### Hosted broker key management

For hosted brokers, the Secure Enclave is not available. The equivalent pattern is TEE-backed key storage:

- Root key generated inside the enclave/TEE.
- Signing operations invoked through the TEE interface without key extraction.
- Key release conditioned on runtime attestation measurements.
- The architectural boundary is the same — the broker can use the key but never see it — just implemented with different hardware.

The attestation’s `trustTier` and `hostingMode` fields should reflect whether hardware-backed key storage is in use.

## Key Rotation

Key rotation is essential for operational continuity — machines change, hardware fails, and security hygiene requires periodic rotation.

### Machine migration

Secure Enclave keys are non-exportable and device-bound by hardware design. Moving to a new machine means:

1. Authenticate on the new machine (biometric enrollment).
1. The broker creates new enclave-backed keys on the new hardware.
1. The broker performs an XMTP installation rotation — the agent’s inbox identity persists, but the signing key material rotates.
1. The broker publishes an updated attestation reflecting the new key material and any updated verifier statements.
1. The old machine’s keys are revoked.

This is cleaner than a “recovery key” approach because it avoids ever having exportable root material. There are no seed phrases or recovery keys to secure, leak, or lose. The agent’s identity continuity is maintained through XMTP’s installation management, not through key portability.

### Periodic rotation

Even without a machine change, operational keys should support periodic rotation as a security hygiene measure. The broker should be able to rotate operational keys without disrupting active sessions — new sessions use the new key, existing sessions continue until their natural expiry, and the attestation is updated to reflect the rotation.

### Rotation attestation

Any key rotation event is a material change and should produce a group-visible attestation update. The group should be able to see that key material changed, when it changed, and that the new material chains back to a valid root.

## Candidate XIP Directions

This proposal is intentionally app-layer first, but several pieces are candidates for future XIPs.

### Capability Attestation XIP (recommended first)

Standardize a portable, signed attestation format for agent capabilities.

Potential scope:

- Required attestation fields (including structured egress/inference fields).
- View and grant semantics.
- Update semantics and materiality thresholds.
- Revocation semantics.
- Ownership and issuer model.
- Attestation references in agent-authored messages.

This is recommended as the first XIP because it is the foundation everything else references.

### Broker Verification Statement XIP

Standardize the verification request and verification statement content types.

Potential scope:

- Verification request format.
- Verification statement format.
- Issuer / expiry / revocation semantics.
- Standard verification classes (self-asserted, source-verified, build-provenance-verified, runtime-attested).
- Standard way for attestations to reference verifier statements.

### Agent Message Provenance XIP

Standardize how agent-authored messages indicate:

- Which attestation they were produced under.
- Whether the agent was acting with full, reveal-only, or other view modes.
- Whether tool use or external actions were involved.

### Group-Scoped Delegation XIP

Explore a first-class group-scoped delegated principal model.

This would be richer than inbox-level delegation and better aligned with group agent use cases.

Possible semantics:

- Delegate bound to one group.
- Scoped capabilities.
- Auto-revocation if delegator is removed.
- Optional multi-admin approval.

### Reveal Policy XIP

Define portable message or thread-level policy objects for assistant visibility and reveal intent.

This could give apps a shared language for:

- Hidden from assistant.
- Revealed to assistant.
- Reveal thread.
- Revoke future reveal.

### Hosting and Trust Disclosure XIP

Standardize a lightweight representation of hosting mode and trust posture.

For example: local, self-hosted, managed, hybrid.

This would help clients surface the real trust boundary to users.

## Why XIPs matter here

Without standardization, each app may invent different agent policy semantics, provenance formats, and UX expectations.

A small number of targeted XIPs could:

- Improve interoperability.
- Make clients more consistent.
- Reduce ambiguity around agent posture.
- Encourage healthier defaults across the ecosystem.

## Convos-Specific Opportunities

Convos can add flavor to this model without waiting for protocol-level changes.

### Identity and presentation

- Present agents as first-class conversation participants with visible capability posture.
- Highlight owner relationship and hosting mode.
- Show trust tier alongside hosting mode.
- Show when an agent is scoped to one convo versus broadly reused.

### Message UX

- Reveal-to-assistant controls inline.
- Thread-level visibility toggles.
- Agent-only summaries.
- Hidden content placeholders.
- Timeline notices when capabilities change (material changes only).

### Trust and safety UX

- Explain what the assistant can currently access.
- Show inference and egress posture clearly.
- Show when content may leave the device or local broker boundary.
- Require confirmations for send, tool use, or risky actions.
- Make revocation easy and legible.
- Show agent offline/staleness state.

### Developer and power-user UX

- Attach to local broker.
- Attach to self-hosted broker.
- Inspect active session details.
- Inspect attestation history.
- Export broker fingerprints and configuration.

## Rollout Strategy

### Phase 1

- Define broker, view, grant, attestation, and session concepts.
- Ship local broker reference implementation with Secure Enclave-backed key management.
- Implement derived key hierarchy (root → operational → session).
- Ship open source reference verifier (Cloudflare Workers / Railway).
- Expose WebSocket interface.
- Support basic view modes (full, reveal-only) and grant configurations.
- Ship Convos experimental client integration.
- Define structured egress/inference disclosure fields.

### Phase 2

- Add self-hosted deployment templates.
- Add MCP and SDK adapters.
- Add permission editing UX.
- Add attestation timeline UX (material changes only).
- Add action confirmations and richer tool scopes.
- Verifier-over-XMTP flow operational.
- Draft Capability Attestation XIP based on implementation learnings.

### Phase 3

- Add managed broker product surface.
- Add hybrid control-plane support.
- Add key rotation and machine migration flows.
- Add coordinating agent pattern for dynamic agent creation.
- Add reproducible build verification support.
- Draft Broker Verification Statement XIP.
- Explore runtime attestation integration (TEE-agnostic) with TEE-backed key storage for hosted brokers.

## Open Questions

- What is the exact minimum viable attestation schema?
- How should clients render stale or expired attestations?
- How should reveal history be represented in UX?
- Should session issuance be tied to explicit per-thread scopes by default?
- How much policy should be in-group versus off-chain broker config?
- What is the cleanest recovery story for one-click hosted deployments?
- Which verification classes should the reference verifier support at launch?
- What is the appropriate default heartbeat interval?
- How should content type allowlist updates be surfaced in client UX?

## Success Criteria

The proposal is successful if it achieves the following:

- Agents no longer need raw XMTP credentials in the harness to participate in a useful way.
- Users can run local or hosted agents through the same conceptual model.
- Group members can understand what an agent can do right now.
- Permission changes become visible and attributable.
- Egress and inference posture is explicitly disclosed, not hidden.
- A reference verifier is available for early trust verification.
- Apps such as Convos can create a rich, understandable UX without waiting on large protocol changes.
- The model produces enough clarity and adoption pressure to justify one or more focused XIPs.

## Risks

### Technical risks

- Broker complexity grows too quickly.
- Too much app-layer behavior creates interop fragmentation.
- Reveal semantics become inconsistent across clients.
- Hosted deployment is oversold relative to its trust boundary.
- Multi-agent isolation within a single broker proves harder than expected.

### Product risks

- Users misunderstand the difference between local and hosted modes.
- The view and grant model feels too complex.
- Too much UX ceremony discourages agent usage.
- Attestations become noisy despite the materiality threshold.
- Group members feel powerless under the v1 owner-only governance model.

### Mitigations

- Keep v1 narrow.
- Start with simple view modes and basic grants.
- Make hosting mode and trust tier explicit.
- Focus first on clear provenance and meaningful enforcement.
- Ship the reference verifier early for fast trust bootstrapping.
- Standardize only after implementation learning.
- Name the v1 governance asymmetry explicitly so expectations are set.

## Recommendation

Proceed with an app-layer broker architecture as the primary design direction.

Start with:

- A local broker reference implementation with Secure Enclave-backed key management.
- A purpose-built key management layer (inspired by keypo-cli’s architecture, built in-house for supply chain integrity).
- Derived key hierarchy with biometric-gated privilege escalation.
- WebSocket as the primary live interface.
- Structured view and grant model.
- Group-visible capability attestations with structured egress disclosure.
- An open source reference verifier deployable to Cloudflare Workers or Railway.
- Convos as a rich UX proving ground.
- Self-hosted templates for Fly and Railway.
- A Cloudflare-friendly hybrid control-plane design.

Use implementation learnings to identify which parts should become formal XIPs, starting with Capability Attestation.

## Appendix: Crisp Framing

The simplest way to explain the proposal is:

- The **broker** is the real XMTP client.
- The **view** is what the agent is allowed to see.
- The **grant** is what the agent is allowed to do.
- The **attestation** is what the group is told about that view and grant.
- The **session** is how the harness connects to it.
- The **verifier** is how the group can check whether the broker is what it claims.

Or more simply:

**The group trusts the attestation. The broker enforces the view and grant. The agent never touches the raw client. The verifier keeps the broker honest.**