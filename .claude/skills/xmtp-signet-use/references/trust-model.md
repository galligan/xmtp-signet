# Trust Model

## From opaque to inspectable

Today, nobody should trust an XMTP agent just because it exists in a chat. An
agent is just another XMTP inbox — you don't know what code is behind it,
whether it has raw credentials, or whether its claimed limits are real.

The signet model doesn't solve trust by decree. It moves from **opaque trust**
(take the agent's word for it) to **inspectable trust** (verify what it can
actually do via signed attestations).

**The honesty clause:** A signet doesn't magically make an agent trustworthy.
It makes the system auditable and constrainable in a way today's pattern is
not. A determined operator could still lie — but they'd have to sign a false
attestation, which creates a verifiable record.

## Verification service

The verifier runs 6 independent checks against an agent's attestation. Each
check produces a verdict:

| Verdict | Meaning |
|---------|---------|
| `pass` | Check succeeded with evidence |
| `fail` | Check failed with reason |
| `skip` | Check not applicable or insufficient data |

### Check 1: Source available

Verifies that the agent's source code is publicly accessible at the claimed
repository URL. Checks for a valid, reachable repository with recent commits.

### Check 2: Build provenance

Verifies that the running binary was built from the claimed source. Looks for
build attestations (e.g., SLSA provenance) linking the artifact to a specific
source commit.

### Check 3: Release signing

Verifies that release artifacts are cryptographically signed. Checks for valid
signatures from a known release key.

### Check 4: Attestation signature

Verifies that the attestation itself was signed by a valid key in the agent's
key hierarchy. Checks the signature against the operational key and validates
the key chain back to the root.

### Check 5: Attestation chain

Verifies that the attestation correctly references its predecessor. Each
attestation includes the hash of the previous attestation, forming a chain.
A broken chain indicates tampering or a gap in the record.

### Check 6: Schema compliance

Verifies that the attestation conforms to the expected schema. Checks field
presence, types, and value constraints. A non-compliant attestation may
indicate a buggy or outdated signet.

## Trust tiers

The combined check results map to a trust tier:

| Tier | Required checks | What it means |
|------|----------------|---------------|
| `unverified` | None | No verification performed or all checks skipped |
| `self-attested` | Attestation signature + chain + schema | Agent's own attestation is valid and consistent |
| `source-verified` | Self-attested + source available | Source code is inspectable |
| `build-verified` | Source-verified + build provenance | Binary provably built from source |
| `fully-verified` | All 6 checks pass | Complete verification chain |

Trust tiers are **descriptive, not prescriptive**. They tell group participants
what has been verified — they don't automatically grant or restrict anything.
How a client uses trust tiers (display badges, show warnings, block
interaction) is up to the client app.

## Verifier service architecture

The verifier is a standalone service that can run independently of the signet.
It:

- Accepts verification requests via XMTP content types
- Runs checks against the attestation and external evidence
- Publishes verification statements back to the group
- Rate-limits requests to prevent abuse
- Caches statements to avoid redundant verification
- Self-attests its own capabilities so participants know what it can verify

Multiple verifiers can operate in the same group, providing independent
assessments. This avoids single points of trust.

## Materiality and attestation noise

Not every signet state change warrants a group-visible seal. The
system classifies changes as material or routine:

**Material** (produces seal):
- View mode or scope changes
- Grant additions or removals
- Egress or inference policy changes
- Agent addition or revocation
- Ownership or hosting mode changes
- Verifier statement updates

**Routine** (stays silent):
- Session rotation within the same view and grant
- Heartbeat and liveness signals
- Internal signet housekeeping

Changes that expand the security boundary (e.g., upgrading from `reveal-only`
to `full` visibility) also require **session reauthorization** — the signet
terminates the current session and requires the harness to re-authenticate
under the updated policy.
