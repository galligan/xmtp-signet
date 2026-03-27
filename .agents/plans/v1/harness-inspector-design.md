# Harness Inspector Plugin Design

**Status:** Exploratory — design only, no implementation yet
**Date:** 2026-03-26

## Problem

Operator disclosures on seals (`inferenceMode`, `inferenceProviders`,
`contentEgressScope`, `retentionAtProvider`, `hostingMode`) are self-reported.
The signet passes them through without independent confirmation. Consuming
interfaces render these as `declared` provenance, which is honest but offers
no trust signal beyond the operator's word.

## Goal

Allow a signed, XMTP-built plugin running inside the harness environment to
independently inspect runtime conditions and produce attestations that upgrade
`declared` claims to `observed` provenance.

## Constraints

- The signet never runs inside the harness — it has no direct visibility
  into the harness environment. Inspectors bridge this gap.
- Inspectors must be independently verifiable — signed builds, source
  available, build provenance — using the same trust chain as the signet
  itself.
- Inspectors must not require harness authors to trust arbitrary code.
  Only XMTP-signed inspector builds are accepted.
- The protocol must work over the existing WebSocket transport between
  harness and signet.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Harness Environment                        │
│                                             │
│  ┌──────────┐    ┌──────────────────────┐   │
│  │ Harness  │    │ Inspector Plugin     │   │
│  │ (agent)  │    │ (signed XMTP build)  │   │
│  └────┬─────┘    └──────────┬───────────┘   │
│       │                     │               │
│       │    WebSocket        │  inspection   │
│       │    transport        │  results      │
│       ▼                     ▼               │
├─────────────────────────────────────────────┤
│  Signet                                     │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Inspector Attestation Handler       │    │
│  │ - Verify inspector signature        │    │
│  │ - Validate inspector build chain    │    │
│  │ - Merge results into provenanceMap  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## Inspector Lifecycle

1. **Registration**: Harness registers an inspector plugin with the signet
   over WebSocket, providing the inspector's signed build provenance bundle.

2. **Verification**: The signet verifies the inspector's build provenance
   using the same Sigstore/SLSA chain used for agent verification. Only
   XMTP-signed inspector builds are accepted (enforced via OIDC identity
   pattern matching).

3. **Inspection**: The inspector runs inside the harness and examines the
   local environment:
   - Network configuration (egress rules, DNS, firewall)
   - Process table (inference providers running locally vs. remote calls)
   - Environment variables (provider API keys, endpoints)
   - Runtime configuration files

4. **Attestation**: The inspector produces a signed attestation about what
   it observed, covering the specific disclosure fields it can verify.

5. **Provenance upgrade**: The signet validates the inspector's attestation
   signature, checks it against the registered inspector identity, and
   upgrades matching `declared` entries in the provenanceMap to `observed`.

## Inspector Attestation Schema

```typescript
interface InspectorAttestation {
  /** Unique attestation ID. */
  attestationId: string;
  /** Inspector's signed build identity. */
  inspectorId: string;
  /** Which disclosure fields were inspected. */
  inspectedFields: {
    field: string;
    /** What the inspector observed. */
    observedValue: unknown;
    /** Whether the observation matches the operator's declaration. */
    matches: boolean;
  }[];
  /** When the inspection was performed. */
  inspectedAt: string;
  /** How long until this attestation should be refreshed. */
  ttlSeconds: number;
  /** Ed25519 signature over canonical attestation bytes. */
  signature: string;
}
```

## What Inspectors Can and Cannot Verify

### Inspectable (can upgrade to `observed`)

| Field | How |
|-------|-----|
| `inferenceMode` | Check for local model processes, detect outbound API calls to known provider endpoints |
| `inferenceProviders` | Inspect outbound network connections, API key env vars, config files |
| `hostingMode` | Detect TEE environment markers (SGX, SEV, Nitro attestation docs), cloud metadata endpoints |
| `contentEgressScope` | Monitor outbound network traffic patterns over inspection window |

### Difficult to Inspect

| Field | Why |
|-------|-----|
| `retentionAtProvider` | Retention is a policy on the provider's side — inspector can confirm which provider is used, but not their retention policy |

### Not Inspector's Job

| Concern | Why |
|---------|-----|
| Permission scopes | Derived by the signet — already `verified` |
| Seal chain integrity | Verified by the verifier service |
| Build provenance | Verified by the verifier service |

## Transport Protocol

Inspectors communicate with the signet over the existing WebSocket
transport using a new message type:

```typescript
// Harness → Signet
interface InspectorRegistration {
  type: "inspector.register";
  inspectorId: string;
  buildProvenanceBundle: string; // base64 Sigstore bundle
}

// Harness → Signet
interface InspectorReport {
  type: "inspector.report";
  inspectorId: string;
  attestation: InspectorAttestation;
}

// Signet → Harness
interface InspectorAck {
  type: "inspector.ack";
  inspectorId: string;
  accepted: boolean;
  upgradedFields: string[]; // fields that were upgraded to observed
  reason?: string; // if not accepted, why
}
```

## Trust Model

1. **Inspector identity**: Tied to XMTP-signed builds. The OIDC identity
   pattern in the Sigstore bundle must match an XMTP-controlled CI identity.
   This prevents third-party inspectors from claiming `observed` status.

2. **Inspector isolation**: The inspector runs in the harness but is a
   separate binary/process. It inspects the environment from outside the
   harness code. A compromised harness could potentially interfere with
   the inspector, but:
   - The inspector's observations are signed — tampering is detectable
   - The `observed` tier is explicitly lower than `verified` — UIs
     communicate this distinction
   - Future TEE-based inspectors could run in an enclave for stronger
     isolation

3. **Freshness**: Inspector attestations carry a TTL. The signet must
   re-request inspection before the TTL expires, or the provenance
   downgrades back to `declared`.

4. **Mismatch handling**: If the inspector observes a value that doesn't
   match the operator's declaration, the signet:
   - Does NOT upgrade the field to `observed`
   - Logs the mismatch
   - Optionally publishes the mismatch in the seal delta (future)

## Open Questions

1. **Should mismatches be visible in the seal?** If an inspector finds that
   `inferenceMode: "local"` is declared but cloud API calls are observed,
   should this be surfaced to group members? Leaning yes — transparency is
   the whole point.

2. **Inspector versioning**: How do we handle inspector updates? The build
   provenance bundle pins a specific build. Inspector rotation would need
   a re-registration flow.

3. **Multiple inspectors**: Should the signet accept attestations from
   multiple inspectors for the same field? If so, what's the merge
   strategy? Strictest-wins seems right.

4. **Inspection frequency**: Should the signet drive inspection cadence,
   or should the inspector self-schedule? Signet-driven is simpler and
   more predictable.

## Implementation Phases

**Phase 1** (v2): Define inspector attestation schema, registration
protocol, and provenance upgrade logic in the signet. No actual inspector
binary yet.

**Phase 2** (v2+): Build a reference inspector that checks
`inferenceMode` and `hostingMode` via environment detection. Ship as a
signed XMTP build.

**Phase 3** (v3): Network-level inspection for `contentEgressScope` and
`inferenceProviders`. Requires deeper OS-level access.
