# Phase 2 Decision Log

**Created:** 2026-03-14
**Purpose:** Capture decisions about Phase 1 completeness, Phase 2 readiness, and deferment reconsideration before implementation begins.

## Questions and Decisions

### Q1: Secure Enclave as hard dependency for CLI

**Context:** We said "vault-only, Secure Enclave is a hard dep" but Linux has no Secure Enclave, and even macOS CI may lack biometric access.

**Decision:** Tiered key protection with Secure Enclave as a goal, not a gate.

- Start with password-encrypted vault (Alternative B) to unblock implementation
- Push to get Secure Enclave working before the big push is "done"
- For non-biometric / Linux / cross-platform: explore **passkeys (WebAuthn/FIDO2)** as hardware-backed auth for vault unlock. `init` could fire up a web UI or terminal flow for passkey setup.
- Consider **macOS Keychain** as a middle tier (software-encrypted, login-gated, distinct from Secure Enclave hardware)
- Root key generated once, written to a file (never displayed to terminal). CLI warns on subsequent boots that the file is still present and should be recorded elsewhere and deleted.
- Goal: many strong options before falling back to a simple password

**Protection tiers (strongest to weakest):**
1. Secure Enclave (macOS, hardware P-256, non-extractable)
2. macOS Keychain (OS-managed encryption, login-gated)
3. Passkeys / WebAuthn (cross-platform, hardware-backed where available)
4. One-time root key file (generated once, user records elsewhere, CLI warns until deleted)

**Key invariant preserved:** No raw keys in env vars, CLI args, or persistent keyfiles. The vault is always the access path.

---

### Q2: Harness-side client SDK

**Context:** PRD calls for SDK adapters. We have broker-side transports (WebSocket, MCP) but no package for harness developers to connect their agents.

**Decision:** Add **Spec 15: Handler SDK** (`@xmtp-broker/handler`).

- Thin TypeScript client that connects to the broker WebSocket
- Handles auth handshake, reconnection, sequence replay
- Provides typed event stream (async iterable) and request methods
- Exports types for all events, requests, responses
- This is NOT a harness — it's the connection handler. Harness-specific adapters (Claude Agent SDK, OpenAI, etc.) come later and wrap this package.
- Name: `handler` not `harness` — the package handles the connection, it isn't the harness itself.

---

### Q3: Tool capability and egress enforcement

**Context:** PRD grant model includes tool capabilities (calendar, payment, HTTP, custom) and retention/egress caps. These are schema-defined but have no enforcement logic in any spec.

**Decision:** Defer. The broker can't enforce what happens inside an agent's runtime. Tool and egress enforcement would be theater — the broker controls what it forwards, not what the agent does with received data. These concepts also have no real connection to XMTP yet.

- Messaging and group management grants: enforced at the broker boundary (already spec'd)
- Content type allowlists: enforced by the policy engine (already spec'd)
- Tool and egress posture: declared in the attestation (honesty-based, per PRD)
- **Future idea:** Tool grant registry where broker gates `tool_call` requests that flow through it. Only useful once tool calls are a first-class XMTP concept.

---

### Q4: Convos integration

**Context:** PRD Phase 1 includes "Ship Convos experimental client integration." No spec covers this. Convos is a separate repo.

**Decision:** Don't spec it as a broker package. Write a design doc (in `.agents/docs/design/`) describing what Convos integration would look like — the migration path from direct SDK usage to brokered access, which broker APIs to use, CLI surface areas. This serves as a guide for an experimental patch later.

- Not a numbered spec — it's a downstream consumer guide
- Depends on: spec 08 (WebSocket), spec 15 (handler SDK)
- Track Convos integration work outside the broker repo
- The doc should be concrete enough to attempt an experimental patch against Convos

---

### Q5: Phase 1 completeness — integration validation

**Context:** Phase 1 produced 9 packages across 12 stacked PRs. Individual packages have unit tests, but nothing proves they compose correctly end-to-end.

**Decision:** Write a comprehensive integration test suite before starting Phase 2 implementation. Not just one smoke test — a full validation that Phase 1 is solid.

Test scenarios to cover:
1. **Full happy path**: Harness connects via WebSocket → authenticates with session token → receives filtered message stream → sends a message through a grant → sees the response
2. **Attestation lifecycle**: Issue attestation → publish to group → refresh → verify chain → revoke
3. **Policy enforcement**: View filters messages correctly across all 5 view modes. Grant denies unauthorized actions. Content type allowlist blocks unlisted types.
4. **Session lifecycle**: Issue → heartbeat → expire → reconnect with replay → revoke mid-session
5. **Key hierarchy**: Root key → derive operational → derive session → sign attestation → verify signature chain
6. **WebSocket edge cases**: Auth timeout, backpressure, reconnection replay, graceful shutdown drain
7. **Cross-package wiring**: Verify that contracts interfaces actually match their implementations (no signature drift between spec and code)

This becomes the regression suite that protects Phase 2 from breaking Phase 1.

---

### Q6: Per-group identity orchestration

**Context:** Per-group identity is default-on. Spec 03 has ClientRegistry, spec 07 has per-identity operational keys, spec 11 wires SDK. But the flow of "new group → new identity" isn't explicit.

**Decision:** Clarify in spec 11 (not a new spec). The flow is:

- When per-group identity is on, creating or joining a group means a new identity is created for that group. It's one atomic operation — not "add broker identity first, then create another."
- `BrokerCore` calls `ClientRegistry` which calls `SdkClientFactory.create()` with a fresh identity
- The new identity is the one that joins/creates the group
- Add a paragraph to spec 11 clarifying this delegation from BrokerCore → ClientRegistry → SdkClientFactory

---

### Q7: Admin MCP surface

**Context:** We flipped MCP to harness-facing. CLI is the only admin surface. But an operator using Claude Code might want admin MCP tools.

**Decision:** No admin MCP for now. The ActionSpec pattern (spec 10) leaves the door open — a future admin MCP would just be a second MCP server reading `ActionRegistry.listForSurface("mcp-admin")`. Zero additional design work needed when the time comes.

---

### Q8: Phase 2 branch stack sequencing

**Context:** Plan has linear stack: 10 → 11 → 12 → 13 → 14. Could re-sequence into parallel tracks.

**Decision:** Keep the linear stack. Graphite handles conflicts well, easier to get to the top branch and validate everything works together. Fixes are trivial with `gt absorb -a`. Add integration tests and handler SDK to the sequence.

Updated stack:
```
v0/docs (current top)
  └── v0/phase1-integration-tests  (validation gate)
       └── v0/action-registry       (spec 10)
            └── v0/sdk-integration  (spec 11)
                 └── v0/admin-keys   (spec 12)
                      └── v0/daemon-cli  (spec 13)
                           └── v0/mcp-transport  (spec 14)
                                └── v0/handler-sdk  (spec 15)
```

---

### Q9: Self-hosted deployment

**Context:** PRD Phase 2 includes "Add self-hosted deployment templates." No spec covers this.

**Decision:** Defer until Phase 2 code works locally. Deployment templates are mechanical once the daemon binary exists. Not a numbered spec — a follow-on task after spec 13 is implemented.

- Explicitly called out as the next thing after Phase 2 code is working
- Start with local Docker (Dockerfile + docker-compose)
- Then Railway/Fly one-click templates
- The verifier (spec 09) already has a Dockerfile pattern to follow

---

### Q10: Summary-only view mode

**Context:** Schema field exists in attestations. PLAN.md said "implementation deferred to Phase 2." We're now in Phase 2.

**Decision:** Keep deferred. No current use case driving it. Summary-only requires the broker to generate content (LLM integration), which is a fundamentally different architectural concern. The schema field stays so attestations can declare it if needed later. Don't implement until there's a real use case.

---

### Q11: Write Spec 15 (Handler SDK) now or later?

**Context:** We decided to add it (Q2) and it's in the branch stack (Q8). The other 5 Phase 2 specs are written and reviewed.

**Decision:** Write it now, before implementation starts. Full stack of specs should be complete and reviewed before any code is written. Done — spec written.

---

### Q12: Remaining gaps before implementation

**Context:** Final check for anything that would force an implementing agent to make decisions.

**Decision:** Fix 5 small items, defer 1:

1. Spec 11: Add per-group identity orchestration paragraph (Q6) — **fix now**
2. Specs 11, 13, 14: Pin dependency versions — **fix now**
3. Integration test plan: Write lightweight doc — **fix now**
4. Convos design doc (Q4): Defer until handler SDK exists — **later**

---

