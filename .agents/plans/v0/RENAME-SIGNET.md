# Rename: xmtp-broker → XMTP Signet

**Decision date:** 2026-03-17
**Status:** Approved, not yet executed

## Product Identity

- **Product name:** XMTP Signet
- **Repo:** xmtp-signet (rename from xmtp-broker)
- **NPM scope:** @xmtp/signet-* (e.g. @xmtp/signet-core, @xmtp/signet-sdk)
- **Binary:** `xmtp-signet` with `xs` alias
- **Prose:** "the signet" (lowercase when referring to the runtime)

## Why "Signet"

The broker isn't just mediating connections — it's a system that issues scoped, time-limited, revocable credentials from a root of trust. A signet ring is the historical instrument of delegated authority: the holder stamps sealed documents that declare specific terms, recipients can verify the seal, and the ring never leaves the owner.

The Ramp (finance) analogy: instead of giving agents the real credit card (raw XMTP keys), the signet issues virtual cards (sessions) with spending limits (grants), merchant restrictions (views), expiry, and instant cancellation.

## Core Concept: Seal

The attestation system is renamed to **seal**. Physical seal properties map perfectly:

- Wax seal stamped with signet ring → attestation signed with operational key
- Breaking the seal = visible tampering → permission change = old attestation invalidated
- Anyone can inspect an intact seal → group members can verify current attestation
- New letter requires new seal → new session/grant requires new attestation
- The signet ring never leaves the owner → signing key never leaves the vault

## Terminology Map

### Changes

| Before | After | Notes |
|--------|-------|-------|
| xmtp-broker | xmtp-signet | Repo, docs, prose |
| @xmtp-broker/* | @xmtp/signet-* | NPM packages |
| broker (CLI group) | signet start/stop/status | Binary is `xmtp-signet`, alias `xs` |
| BrokerError | SignetError | Base error type |
| BrokerCore | SignetCore | Core runtime |
| BrokerCoreConfig | SignetCoreConfig | |
| BrokerEvent | SignetEvent | |
| attestation | seal | Core concept rename |
| @xmtp-broker/attestations | @xmtp/signet-seals | Package rename |
| AttestationManager | SealManager | |
| SignedAttestation | Seal | |
| SignedAttestationEnvelope | SealEnvelope | |
| AttestationSigner | SealStamper | |
| AttestationPublisher | SealPublisher | |
| AttestationError | SealError | |
| attestation.updated (event) | seal.stamped | |
| broker.recovery.complete | signet.recovery.complete | |
| @xmtp-broker/handler | @xmtp/signet-sdk | "XMTP Signet SDK" |

### No Change

These terms stay as-is:

- **View**, **Grant**, **Session**, **Identity** — core concepts
- **Root key**, **Operational key**, **Session key** — key hierarchy
- **Handler**, **ActionSpec**, **HandlerContext** — internal architecture
- **Policy engine**, **View projection**, **Grant validation** — internal mechanics
- **Trust tier**, **Trust chain** — verification concepts
- **isMaterialChange()**, **requiresReauthorization()** — internal functions
- **Convos** — external protocol

## Package Map

| Before | After |
|--------|-------|
| @xmtp-broker/schemas | @xmtp/signet-schemas |
| @xmtp-broker/contracts | @xmtp/signet-contracts |
| @xmtp-broker/core | @xmtp/signet-core |
| @xmtp-broker/keys | @xmtp/signet-keys |
| @xmtp-broker/sessions | @xmtp/signet-sessions |
| @xmtp-broker/attestations | @xmtp/signet-seals |
| @xmtp-broker/policy | @xmtp/signet-policy |
| @xmtp-broker/verifier | @xmtp/signet-verifier |
| @xmtp-broker/ws | @xmtp/signet-ws |
| @xmtp-broker/mcp | @xmtp/signet-mcp |
| @xmtp-broker/handler | @xmtp/signet-sdk |
| @xmtp-broker/cli | @xmtp/signet-cli |
| @xmtp-broker/integration | @xmtp/signet-integration |

## CLI

Binary: `xmtp-signet` with `xs` symlink.

```
xs start                                  # start the signet daemon
xs stop                                   # stop
xs status                                 # show status

xs identity init --env dev --label my-agent
xs identity list

xs session issue --agent <id> --view @v.json --grant @g.json
xs session list
xs session inspect <id>
xs session revoke <id>

xs seal inspect <session-id>              # view current seal
xs seal verify <session-id>               # verify seal integrity
xs seal history <session-id>              # seal chain

xs conversation create --name "test" --as my-agent
xs conversation list
xs conversation join <invite-url>
xs conversation invite <group-id>

xs admin token
```

## Execution Plan

This is a mechanical rename — large in scope but low in risk. Execute as a single commit on a new branch after the current stack merges to main.

### Phase 1: Code rename (one commit)
1. Rename `packages/` directories (attestations → seals, handler → sdk)
2. Update all `package.json` names (@xmtp-broker/* → @xmtp/signet-*)
3. Find-and-replace Broker → Signet in type names
4. Find-and-replace attestation → seal in the seals package
5. Update imports across all packages
6. Update CLI binary name and command group
7. Update CLAUDE.md, README.md, docs/

### Phase 2: Repo rename (GitHub)
1. Rename repo xmtp-broker → xmtp-signet on GitHub
2. Update all internal references

### Phase 3: NPM publish setup
1. Confirm @xmtp org access
2. Set up package publishing for @xmtp/signet-* scope

## Narrative

> **XMTP Signet** is a security layer for XMTP agents. The signet holds your XMTP identity — keys, signer, database — and issues scoped sessions to agent harnesses. Each session carries a **seal**: a signed, group-visible declaration of what the agent can see and do.
>
> When permissions change, the old seal breaks and a new one is stamped. Other group members can verify the seal to know exactly what the agent is allowed to do — moving from opaque trust to inspectable trust.
>
> The agent harness never touches raw keys. It connects through the signet and operates within its sealed terms.
