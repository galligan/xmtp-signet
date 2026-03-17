# 09-verifier

**Package:** `@xmtp-broker/verifier`
**Spec version:** 0.1.0

## Overview

The verifier is a standalone service that checks broker claims and issues signed verification statements. It exists to answer a single question: "Is this broker what it claims to be?" The answer takes the form of a cryptographically signed statement that brokers can reference in their group-visible attestations via the `verifierStatementRef` field.

The verifier is itself an XMTP inbox. All verification happens over XMTP DMs -- there is no HTTP API, no privileged endpoint, no central authority. A broker (or any group member) opens a DM with the verifier, sends a verification request, and receives a signed verification statement in response. This design means the protocol surface is identical whether the verifier is the reference deployment, a community-run instance, or a self-hosted container. The decentralization path is baked in from day one.

At v0 launch, the verifier supports only the **source-verified** trust tier: checking source code availability, build provenance (SLSA/Sigstore), release signing, and attestation chain validity. Runtime attestation (TEE) verification is deferred to Phase 2.

The verifier publishes its own attestation about its identity and capabilities so that clients can decide which verifier issuers they trust. Multiple independent verifiers can coexist -- no single verifier has authority over the ecosystem.

## Dependencies

**Imports:**
- `@xmtp-broker/contracts` -- `SignedAttestationEnvelope`, `SignedRevocationEnvelope` (consumed for parsing attestations during verification)
- `@xmtp-broker/schemas` -- `AttestationSchema`, `TrustTier`, `ValidationError`, `InternalError`, `TimeoutError`
- `@xmtp/node-sdk` -- XMTP client for DM-based communication
- `better-result` -- `Result` type
- `zod` -- runtime validation

**Imported by:** None (standalone service). Brokers interact via XMTP DMs, not package imports.

## Public Interfaces

### Verification Request Content Type

```typescript
const VERIFICATION_REQUEST_CONTENT_TYPE_ID =
  "xmtp.org/verificationRequest:1.0" as const;
```

### Verification Statement Content Type

```typescript
const VERIFICATION_STATEMENT_CONTENT_TYPE_ID =
  "xmtp.org/verificationStatement:1.0" as const;
```

### Verification Request Schema

```typescript
const VerificationRequestSchema = z.object({
  requestId: z.string()
    .describe("Unique request identifier for correlation"),
  agentInboxId: z.string()
    .describe("XMTP inbox ID of the agent being verified"),
  brokerInboxId: z.string()
    .describe("XMTP inbox ID of the broker operating the agent"),
  groupId: z.string().nullable()
    .describe("Group context for verification, null for broker-wide"),
  attestation: AttestationSchema.nullable()
    .describe("Attestation to verify, null if only checking provenance"),
  artifactDigest: z.string()
    .describe("SHA-256 digest of the broker artifact (hex-encoded)"),
  buildProvenanceBundle: z.string().nullable()
    .describe("Base64-encoded SLSA provenance or Sigstore bundle"),
  sourceRepoUrl: z.string().url()
    .describe("URL of the broker source repository"),
  releaseTag: z.string().nullable()
    .describe("Git tag or release version, null for dev builds"),
  requestedTier: TrustTier
    .describe("Trust tier the requester is claiming"),
  challengeNonce: z.string()
    .describe("Random nonce to prevent replay (hex-encoded, 32 bytes)"),
}).describe("Verification request sent to the verifier via XMTP DM");

type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
```

### Verification Check Result

```typescript
const CheckVerdict = z.enum([
  "pass",
  "fail",
  "skip",
]).describe("Outcome of a single verification check");

type CheckVerdict = z.infer<typeof CheckVerdict>;

const VerificationCheck = z.object({
  checkId: z.string()
    .describe("Identifier for the check type"),
  verdict: CheckVerdict
    .describe("Pass, fail, or skip"),
  reason: z.string()
    .describe("Human-readable explanation of the result"),
  evidence: z.record(z.string(), z.unknown()).nullable()
    .describe("Structured evidence supporting the verdict"),
}).describe("Result of a single verification check");

type VerificationCheck = z.infer<typeof VerificationCheck>;
```

### Verification Statement Schema

```typescript
const VerificationVerdict = z.enum([
  "verified",
  "partial",
  "rejected",
]).describe("Overall verification outcome");

type VerificationVerdict = z.infer<typeof VerificationVerdict>;

const VerificationStatementSchema = z.object({
  statementId: z.string()
    .describe("Unique statement identifier"),
  requestId: z.string()
    .describe("Correlates with the original request"),
  verifierInboxId: z.string()
    .describe("XMTP inbox ID of the verifier that issued this statement"),
  brokerInboxId: z.string()
    .describe("XMTP inbox ID of the broker being verified"),
  agentInboxId: z.string()
    .describe("XMTP inbox ID of the agent being verified"),
  verdict: VerificationVerdict
    .describe("Overall verification outcome"),
  verifiedTier: TrustTier
    .describe("Highest trust tier confirmed by this verification"),
  checks: z.array(VerificationCheck)
    .describe("Individual check results"),
  challengeNonce: z.string()
    .describe("Echoed nonce from the request"),
  issuedAt: z.string().datetime()
    .describe("When this statement was issued"),
  expiresAt: z.string().datetime()
    .describe("When this statement expires"),
  signature: z.string()
    .describe("Base64-encoded Ed25519 signature over canonical statement bytes"),
  signatureAlgorithm: z.literal("Ed25519")
    .describe("Signature algorithm"),
}).describe("Signed verification statement issued by the verifier");

type VerificationStatement = z.infer<typeof VerificationStatementSchema>;
```

### Verifier Self-Attestation

```typescript
const VerifierCapabilities = z.object({
  supportedTiers: z.array(TrustTier)
    .describe("Trust tiers this verifier can check"),
  supportedChecks: z.array(z.string())
    .describe("Check IDs this verifier performs"),
  maxRequestsPerHour: z.number().int().positive()
    .describe("Rate limit per requester per hour"),
}).describe("Capabilities advertised by this verifier");

type VerifierCapabilities = z.infer<typeof VerifierCapabilities>;

const VerifierSelfAttestation = z.object({
  verifierInboxId: z.string()
    .describe("XMTP inbox ID of this verifier"),
  capabilities: VerifierCapabilities
    .describe("What this verifier can do"),
  sourceRepoUrl: z.string().url()
    .describe("URL of the verifier's source code"),
  issuedAt: z.string().datetime()
    .describe("When this self-attestation was created"),
  signature: z.string()
    .describe("Base64-encoded self-signature"),
}).describe("Self-attestation published by the verifier");

type VerifierSelfAttestation = z.infer<typeof VerifierSelfAttestation>;
```

### Verifier Service Interface

```typescript
interface VerifierConfig {
  readonly xmtpKeyBytes: Uint8Array;
  readonly xmtpEnv: "dev" | "production";
  readonly statementTtlSeconds: number;  // default: 86400 (24h)
  readonly maxRequestsPerRequesterPerHour: number;  // default: 10
}

interface VerifierService {
  /** Start the verifier: connect XMTP client, begin listening for DMs. */
  start(): Promise<Result<void, InternalError>>;

  /** Stop the verifier: disconnect XMTP, clean up. */
  stop(): Promise<Result<void, InternalError>>;

  /** Process a single verification request (called by the DM listener). */
  handleRequest(
    request: VerificationRequest,
    senderInboxId: string,
  ): Promise<Result<VerificationStatement, ValidationError | InternalError | TimeoutError>>;

  /** Get the verifier's self-attestation. */
  selfAttestation(): VerifierSelfAttestation;
}

function createVerifierService(
  config: VerifierConfig,
): VerifierService;
```

### Check Handlers

```typescript
/**
 * Each verification check is an independent handler.
 * Checks are stateless and composable.
 */
interface CheckHandler {
  readonly checkId: string;
  execute(
    request: VerificationRequest,
  ): Promise<Result<VerificationCheck, InternalError>>;
}
```

## Zod Schemas

All schemas are defined inline above. The verifier package owns these schemas directly rather than placing them in `@xmtp-broker/schemas`, because the verifier is a standalone service that other broker packages do not import. The content type IDs (`verificationRequest:1.0`, `verificationStatement:1.0`) follow the same `xmtp.org/type:version` convention used by attestations.

## Behaviors

### XMTP DM Flow

```
Requester                    Verifier
(broker or group member)     (XMTP inbox)
    │                            │
    │  DM: VerificationRequest   │
    │───────────────────────────►│
    │                            │ validate request schema
    │                            │ check rate limit
    │                            │ run checks:
    │                            │   source_available
    │                            │   build_provenance
    │                            │   release_signing
    │                            │   attestation_signature
    │                            │   attestation_chain
    │                            │   schema_compliance
    │                            │ determine verdict + tier
    │                            │ sign statement
    │  DM: VerificationStatement │
    │◄───────────────────────────│
    │                            │
    │  (optionally publish       │
    │   statement to group)      │
    │                            │
```

### Request Processing Flow

1. Verifier's XMTP client receives a DM.
2. Parse the message as `VerificationRequestSchema`. If it fails, respond with a `rejected` statement containing a single `schema_compliance` check with verdict `fail`.
3. Check rate limit: look up `senderInboxId` in the rate limiter. If over limit, respond with a `rejected` statement and a `rate_limit_exceeded` check.
4. Run each applicable check handler in parallel. v0 checks:
   - `source_available` -- HTTP HEAD/GET against `sourceRepoUrl`, expect 200
   - `build_provenance` -- If `buildProvenanceBundle` is non-null, parse and verify SLSA provenance or Sigstore bundle
   - `release_signing` -- If `releaseTag` is non-null, check GitHub release for signing signatures
   - `attestation_signature` -- If `attestation` is non-null, verify the Ed25519 signature against the agent's inbox key
   - `attestation_chain` -- If `attestation` is non-null, verify `previousAttestationId` chain has no gaps
   - `schema_compliance` -- If `attestation` is non-null, validate against `AttestationSchema`
5. Determine overall verdict:
   - `verified` -- all applicable checks pass
   - `partial` -- some checks pass, some skip, none fail
   - `rejected` -- any check fails
6. Determine `verifiedTier`: the highest tier for which all required checks pass. For v0, the maximum is `source-verified`.
7. Build `VerificationStatement`, canonicalize (sorted keys, no whitespace, UTF-8), sign with verifier's key.
8. Send the statement back as a DM to the requester.

### Rate Limiting

The verifier tracks request counts per sender inbox ID using an in-memory sliding window.

- Default: 10 requests per requester per hour.
- Configurable via `VerifierConfig.maxRequestsPerRequesterPerHour`.
- Rate limit state is not persisted -- restarting the verifier resets counters. This is acceptable for v0 because the rate limit is a courtesy guard, not a security boundary.

### Check: source_available

```
Check ID: "source_available"
Input: request.sourceRepoUrl
Method: HTTP GET to the repo URL
Pass: HTTP 200 response
Fail: Non-200 response or network error
Evidence: { url, statusCode, responseTimeMs }
```

Uses `fetch()` (Bun-native) with a 10-second timeout. Follows redirects. Only checks that the URL is reachable and returns a successful status -- does not verify repo content.

### Check: build_provenance

```
Check ID: "build_provenance"
Input: request.buildProvenanceBundle, request.artifactDigest
Pass: Bundle is valid SLSA provenance or Sigstore bundle,
      and the subject digest matches request.artifactDigest
Fail: Bundle is malformed, signature invalid, or digest mismatch
Skip: request.buildProvenanceBundle is null
Evidence: { bundleType, subjectDigest, builderIdentity, transparency_log_entry }
```

v0 implementation parses the bundle as JSON, validates structure against SLSA provenance v1.0 or Sigstore bundle format, and verifies the embedded signature chain. Full Rekor transparency log verification (querying the log for inclusion proof) is a stretch goal -- v0 validates the bundle structure and signatures offline.

### Check: release_signing

```
Check ID: "release_signing"
Input: request.sourceRepoUrl, request.releaseTag
Pass: GitHub release exists and has artifact attestations
Fail: Release not found or no attestations
Skip: request.releaseTag is null
Evidence: { releaseUrl, attestationCount, signingIdentity }
```

Uses the GitHub API (`GET /repos/{owner}/{repo}/releases/tags/{tag}` and `GET /repos/{owner}/{repo}/attestations/{digest}`) to verify release existence and artifact attestations. Requires no authentication for public repos.

### Check: attestation_signature

```
Check ID: "attestation_signature"
Input: request.attestation
Pass: Ed25519 signature verifies against the agent's inbox key
Fail: Signature invalid or key not found
Skip: request.attestation is null
Evidence: { signerKeyRef, signatureValid }
```

Canonicalizes the attestation payload using deterministic JSON (same algorithm as `@xmtp-broker/attestations`), then verifies the Ed25519 signature. The agent's public key is resolved via XMTP identity lookup using the `agentInboxId`.

### Check: attestation_chain

```
Check ID: "attestation_chain"
Input: request.attestation, request.groupId
Pass: previousAttestationId is null (initial) or references a known prior attestation
Fail: Chain has gaps or references unknown attestation IDs
Skip: request.attestation is null
Evidence: { chainLength, previousId, chainValid }
```

v0 performs a structural check only: verifies that `previousAttestationId` is either null (for the first attestation) or a well-formed attestation ID. Full chain walk (fetching prior attestations from group history) is deferred -- the verifier cannot access group message history in v0 since it may not be a group member.

### Check: schema_compliance

```
Check ID: "schema_compliance"
Input: request.attestation
Pass: Attestation validates against AttestationSchema
Fail: Schema validation fails
Skip: request.attestation is null
Evidence: { errors (if any) }
```

### Canonical Statement Serialization

The verification statement is signed over its canonical representation. The serialization algorithm is identical to the one used for attestations:

1. Remove the `signature` and `signatureAlgorithm` fields from the statement.
2. Serialize remaining fields as deterministic JSON (sorted keys, no whitespace).
3. Encode as UTF-8 bytes.
4. Sign with Ed25519 using the verifier's private key.

### Verifier XMTP Client

The verifier maintains a persistent XMTP client connection:

- Connects on `start()`, listens for incoming DMs via streaming.
- Filters messages by content type (`verificationRequest:1.0`).
- Ignores messages with other content types.
- Responds in the same DM conversation.
- Disconnects on `stop()`.

### Statement Reference

After receiving a verification statement, the broker stores the `statementId` and references it in subsequent attestations via the `verifierStatementRef` field. The statement itself is not published to the group -- only the reference. Group members who want to validate the statement can request it from the verifier or from the broker.

## Error Cases

| Error | Category | When |
|-------|----------|------|
| `ValidationError` | validation | Request fails schema validation |
| `ValidationError` | validation | Malformed provenance bundle |
| `InternalError` | internal | XMTP client connection failure |
| `InternalError` | internal | Signing failure |
| `TimeoutError` | timeout | Source repo check exceeds 10s timeout |
| `TimeoutError` | timeout | GitHub API check exceeds 10s timeout |

Rate limit violations are not errors in the handler sense -- they produce a `rejected` statement with explanation. The verifier never throws; all check failures produce structured `VerificationCheck` results with `fail` verdicts.

## Open Questions Resolved

**Q: Which verification classes should the reference verifier support at launch?** (PRD Open Questions)
**A:** Source-verified only. The verifier checks: source availability, build provenance (SLSA/Sigstore bundle structure and signatures), release signing (GitHub attestations), attestation signature validity, attestation chain structure, and schema compliance. Runtime attestation (TEE) is deferred to Phase 2. Rationale: source-verified provides meaningful trust signals without requiring TEE infrastructure. It ships something useful fast and establishes the verifier-over-XMTP protocol pattern that runtime attestation will later extend.

**Q: Should the verifier use HTTP or XMTP for communication?** (Implicit from PRD)
**A:** XMTP DMs only. No HTTP API. The verifier is an XMTP inbox that processes DMs. This ensures: (1) the protocol surface is uniform regardless of who runs the verifier, (2) the decentralization path requires no infrastructure changes, (3) any XMTP participant can interact with any verifier using the same tools they use for messaging. The tradeoff is that the verifier requires a persistent XMTP client connection, which rules out purely stateless deployments (like bare Cloudflare Workers).

## Deferred

- **Runtime attestation (TEE) verification.** Phase 2. Requires defining TEE-agnostic attestation evidence formats and integrating with platform-specific verification APIs (AWS Nitro, etc.).
- **Reproducible build verification.** Checking that an artifact reproduces bit-for-bit from source requires running builds, which is out of scope for a lightweight verifier. Deferred until the broker project has reproducible build infrastructure.
- **Rekor transparency log queries.** v0 verifies Sigstore bundle structure and signatures offline. Querying the Rekor transparency log for inclusion proofs adds network dependency and complexity. Stretch goal for v0, required for v1.
- **Full attestation chain walk.** The verifier cannot access group message history to walk the full attestation chain. v0 checks structural validity only. A future version may accept the chain as input or join the group temporarily.
- **Multi-statement aggregation.** v0 supports one verifier statement per attestation (`verifierStatementRef` is a single string). Supporting references to multiple independent verifier statements is deferred.
- **Verifier discovery protocol.** How brokers find verifiers. v0 assumes the verifier inbox ID is configured manually. A discovery mechanism (e.g., well-known XMTP group, ENS records) is future work.
- **Statement revocation.** Verifier statements expire but cannot be actively revoked in v0. If a verifier discovers a previously-verified broker is compromised, it can only refuse new verifications. Active revocation broadcast is deferred.
- **Cloudflare Workers deployment.** The DM-based flow requires a persistent XMTP client, which is incompatible with Workers' stateless execution model. Railway or a long-running container is required for v0.

## Testing Strategy

### What to Test

1. **Request parsing** -- `VerificationRequestSchema` accepts valid requests and rejects malformed ones.
2. **Statement building** -- Statements are schema-compliant, include all checks, and have correct verdicts.
3. **Individual checks** -- Each `CheckHandler` produces correct verdicts for pass, fail, and skip cases.
4. **Verdict determination** -- Overall verdict logic: all pass = verified, some skip = partial, any fail = rejected.
5. **Tier determination** -- `verifiedTier` reflects the highest tier with all required checks passing.
6. **Statement signing** -- Canonical serialization is deterministic; signatures verify.
7. **Rate limiting** -- Requests over the limit produce `rejected` statements.
8. **Nonce echo** -- The `challengeNonce` from the request appears unchanged in the statement.

### Key Test Scenarios

```typescript
// All checks pass -> verified
const request = createTestVerificationRequest({
  sourceRepoUrl: "https://github.com/xmtp/xmtp-broker",
  buildProvenanceBundle: validSlsaBundle,
  releaseTag: "v0.1.0",
  attestation: validAttestation,
  requestedTier: "source-verified",
});
const result = await verifier.handleRequest(request, senderInboxId);
expect(result.ok).toBe(true);
expect(result.value.verdict).toBe("verified");
expect(result.value.verifiedTier).toBe("source-verified");

// Source unavailable -> rejected
const request2 = createTestVerificationRequest({
  sourceRepoUrl: "https://github.com/nonexistent/repo",
});
const result2 = await verifier.handleRequest(request2, senderInboxId);
expect(result2.value.verdict).toBe("rejected");
expect(result2.value.checks.find(c => c.checkId === "source_available")?.verdict)
  .toBe("fail");

// No provenance bundle -> partial (source_available passes, provenance skips)
const request3 = createTestVerificationRequest({
  buildProvenanceBundle: null,
  releaseTag: null,
  attestation: null,
});
const result3 = await verifier.handleRequest(request3, senderInboxId);
expect(result3.value.verdict).toBe("partial");

// Rate limit exceeded
for (let i = 0; i < 11; i++) {
  await verifier.handleRequest(validRequest, senderInboxId);
}
const result4 = await verifier.handleRequest(validRequest, senderInboxId);
expect(result4.value.verdict).toBe("rejected");

// Statement signature verifies
const stmt = result.value;
const canonical = canonicalizeStatement(stmt);
expect(verifyEd25519(canonical, stmt.signature, verifierPublicKey)).toBe(true);

// Nonce is echoed
expect(result.value.challengeNonce).toBe(request.challengeNonce);
```

### Test Utilities

```typescript
/** Creates a valid VerificationRequest fixture. */
function createTestVerificationRequest(
  overrides?: Partial<VerificationRequest>,
): VerificationRequest;

/** Creates a mock HTTP fetcher for source_available checks. */
function createTestFetcher(
  responses: Record<string, { status: number }>,
): typeof fetch;

/** Creates a mock GitHub API client for release_signing checks. */
function createTestGitHubClient(
  releases: Record<string, { attestations: number }>,
): GitHubClient;

/** Creates a fully configured VerifierService with test deps. */
function createTestVerifierService(
  overrides?: Partial<VerifierConfig>,
): VerifierService;
```

## File Layout

```
packages/verifier/
  package.json
  tsconfig.json
  Dockerfile                    # Self-hosted deployment
  src/
    index.ts                    # Re-exports public API
    config.ts                   # VerifierConfig schema and defaults
    content-types.ts            # Content type IDs for request/statement
    schemas/
      request.ts                # VerificationRequestSchema
      statement.ts              # VerificationStatementSchema, VerificationVerdict
      check.ts                  # VerificationCheck, CheckVerdict
      self-attestation.ts       # VerifierSelfAttestation, VerifierCapabilities
    checks/
      handler.ts                # CheckHandler interface
      source-available.ts       # source_available check
      build-provenance.ts       # build_provenance check
      release-signing.ts        # release_signing check
      attestation-signature.ts  # attestation_signature check
      attestation-chain.ts      # attestation_chain check
      schema-compliance.ts      # schema_compliance check
    canonicalize.ts             # Canonical statement serialization
    rate-limiter.ts             # In-memory sliding window rate limiter
    verdict.ts                  # Verdict + tier determination logic
    service.ts                  # VerifierService, createVerifierService()
    xmtp-listener.ts            # XMTP DM listener + message routing
    __tests__/
      request.test.ts
      statement.test.ts
      source-available.test.ts
      build-provenance.test.ts
      release-signing.test.ts
      attestation-signature.test.ts
      attestation-chain.test.ts
      schema-compliance.test.ts
      rate-limiter.test.ts
      verdict.test.ts
      service.test.ts
      fixtures.ts               # Test utilities
```

Each source file targets under 150 LOC. The `checks/` directory isolates each verification check for independent testing and future extensibility. The `schemas/` directory keeps verifier-specific schemas separate from the shared `@xmtp-broker/schemas` package.
