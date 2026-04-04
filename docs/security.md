# Security

This document describes the key management architecture, vault design, identity
isolation, access controls, and threat model for xmtp-signet. For the
conceptual model, see [concepts.md](concepts.md). For package boundaries, see
[architecture.md](architecture.md).

## Design principles

- **No raw key material in the harness.** The harness never holds signing keys,
  vault encryption keys, or database paths.
- **Hardware-backed root when available.** Secure Enclave on macOS, TPM on
  other platforms. Degrades gracefully with honest labeling.
- **Admin and chat keys are firewalled.** Compromising admin auth does not
  compromise message signing, and vice versa.
- **Deny by default.** Empty scope sets deny everything. Every capability must
  be explicitly granted.
- **Fail closed.** Any ambiguity about authorization resolves to denial.
  Revocation is immediate.

## Key hierarchy

The signet maintains a multi-tier key hierarchy. Each tier serves a distinct
purpose and has a different lifecycle.

```text
+-----------------------------------------------------------+
|                        ROOT TIER                          |
|                                                           |
|  Root Key (P-256 ECDSA)                                   |
|  - Generated once on first run, never rotated             |
|  - Protects the vault -- authorizes access to             |
|    operational key material                               |
|  - Hardware-backed via Secure Enclave when available      |
|    (non-exportable by hardware design)                    |
|                                                           |
+-----------------------------------------------------------+
|                     OPERATIONAL TIER                      |
|                                                           |
|  Operational Key (Ed25519, per-identity)                  |
|  - Derived via BIP-39/44 from operator wallet mnemonic   |
|  - Signs XMTP messages                                    |
|  - Signs seals                                            |
|  - Issues credential tokens                               |
|                                                           |
|  Admin Key (Ed25519, singleton)                           |
|  - Signs JWTs for daemon authentication                   |
|  - Independent -- NOT derived from root                   |
|    (admin ops and chat ops are firewalled)                |
|                                                           |
+-----------------------------------------------------------+
|                      EPHEMERAL TIER                       |
|                                                           |
|  Credential Token (per-credential)                        |
|  - Bound to credential scope and TTL                      |
|  - Rejected + revoked on expiry                           |
|  - Revocation kills the connection + message stream       |
|                                                           |
+-----------------------------------------------------------+
|                      AUXILIARY KEYS                       |
|                                                           |
|  DB Encryption Key (32-byte random, per-identity)         |
|  - Encrypts XMTP's local MLS state database               |
|                                                           |
|  XMTP Identity Key (secp256k1, per-identity)              |
|  - Registers the inbox on the XMTP network (0x...)        |
|                                                           |
+-----------------------------------------------------------+
```

### Trust flow

```text
              +--------------------+
              |     Root Key       |
              |      (P-256)       |
              |  vault / enclave   |
              +---------+----------+
                        | protects vault,
                        | authorizes access
                        v
              +--------------------+
              |  Operational Key   |
              |     (Ed25519)      |
              |  BIP-39/44 derived |
              +---------+----------+
                        |
           +------------+------------+
           |            |            |
           v            v            v
     +-----------+ +-----------+ +---------------+
     |   signs   | |   signs   | |    issues     |
     |   XMTP   | |   seals   | |  Credential   |
     |   msgs   | |           | |   Tokens      |
     +-----------+ +-----------+ |   TTL-bound   |
                                 +-------+-------+
                                         |
                                         v
                                 +---------------+
                                 |   authorizes  |
                                 |   harness     |
                                 |   actions     |
                                 +---------------+


     +--------------------+
     |     Admin Key      |  <-- independent, NOT derived from root
     |     (Ed25519)      |      architectural firewall:
     |       vault        |      admin ops != chat ops
     +---------+----------+
               |
               v
     +--------------------+
     |    signs JWTs      |
     |    for daemon      |
     |    auth (CLI)      |
     +--------------------+
```

The root key is P-256 because that is what the Secure Enclave supports. XMTP
uses Ed25519. The bridge: the enclave-backed P-256 root key protects an
encrypted vault containing the Ed25519 operational key material. The enclave
key never signs XMTP messages directly — it authorizes access to the software
keys that do.

## The vault

All persistent key material lives in an encrypted vault.

- **Format:** Keystore v3 — scrypt key derivation + AES-256-GCM encryption,
  OWS-compatible
- **Derivation:** BIP-39 mnemonics derive all inbox keys via BIP-44 paths.
  One wallet per operator. Passes Trezor test vectors.
- **Permissions:** `0o600` on both the vault database and its encryption key
- **Zeroization:** Exported private key bytes are `fill(0)`'d immediately
  after vault storage
- **Secure Enclave protection when available:** the vault secret can be
  hardware-bound and non-exportable via Secure Enclave ECIES. The active
  runtime now uses that path for compat key-manager persisted secret
  material, while broader policy-level gate wiring continues separately.

## MLS and the decryption boundary

The signet is a full MLS group member and can decrypt all group messages it
receives. The permission model is application-layer filtering, not
cryptographic restriction.

But reducing decryption key exfiltration risk is a first-class design
principle. The entire key hierarchy exists to make "has access" not mean "keys
are lying around":

- The MLS state database is encrypted with a per-identity key stored in the
  vault
- The vault itself is scrypt + AES-256-GCM encrypted
- The vault key is protected by the root key
- With Secure Enclave, the root key is hardware-bound and non-exportable

The decryption keys are never available to the harness, never in environment
variables, never in config files. With Secure Enclave, they are never
extractable from the machine at all.

This is a meaningful difference from "the agent has raw keys in an env var."

## Identity isolation

The signet supports two operator scope modes.

### Per-chat (default)

Each chat gets its own wallet key, database encryption key, and XMTP client
instance. From the outside, every group sees a different inbox — there is no
way to correlate that the same signet is behind them.

```text
Signet
 +-- alice-bot (per-chat)
      +-- conv_1  ->  inbox_a  ->  own keys, own inbox, cred_a7f3
      +-- conv_2  ->  inbox_b  ->  own keys, own inbox, cred_b2c1
```

Compromising one identity reveals nothing about others. Group membership lists
never cross-contaminate. Each credential is bound to exactly one chat and one
inbox.

### Shared

A single inbox across all groups. Simpler to operate, but participants in
different groups can see it is the same agent. One credential can span
multiple chats.

```text
Signet
 +-- research-bot (shared)
      +-- conv_1  -+
      +-- conv_2  -+--  inbox_f8g2  ->  one set of keys, cred_e5a1
```

The seal communicates the scope mode to group participants so they know whether
the agent is isolated to their chat or shared across conversations.

### Storage separation

Each operator's message data is encrypted with keys derived from that
operator's credential chain. This is cryptographic separation at the storage
layer, not just access control.

```text
/data/operators/
  op_a7f3/                        # alice-bot's partition
    messages.db (encrypted)
    mls-state/
  op_b2c1/                        # research-bot's partition
    messages.db (encrypted)
    mls-state/
```

## Access matrix

| Capability | operator | admin | superadmin | owner |
|-----------|----------|-------|------------|-------|
| Act in own chats | Yes | Yes | Yes | Via elevation |
| Create operators | No | Scoped (own) | Any | Yes |
| Issue credentials | No | Scoped (own operators) | Any | Yes |
| Revoke credentials | No | Scoped (own) | Any | Yes |
| View metadata | Own only | Own operators | All | All |
| Read messages | Own creds only | Own creds only | Own creds only | Via elevation |
| Elevate to read others' messages | No | Request (owner approves) | Request (owner approves) | Approves (biometric) |

**Critical invariant**: no role — not even superadmin — grants ambient message
read access. The Secure Enclave biometric gate is the only path to message
content outside your own credentials.

## Message access control

Message content is the most sensitive data in the signet. The access controls
enforce two properties: **scope isolation** (you only see messages in
conversations your credential covers) and **information opacity** (you cannot
even learn whether a message exists outside your scope).

### Scope enforcement

When a credential-authenticated caller requests a message (e.g., `message.info`),
the handler enforces a three-part check:

1. **chatId ↔ groupId coupling.** The caller's `chatId` must resolve (via the
   ID mapping store) to the message's actual XMTP `groupId`. This prevents
   cross-conversation fishing — passing a valid message ID with a different chat
   returns not-found.

2. **Credential chat scope.** The message's `groupId` must be in the
   credential's `chatIds` (resolved from `conv_*` local IDs to XMTP group IDs).
   A credential scoped to `conv_A` cannot read messages from `conv_B`, even if
   the underlying identity is a member of both groups.

3. **read-messages permission.** The credential's effective scopes (allow minus
   deny, deny wins) must include `read-messages`. A credential with only `send`
   and `reply` scopes cannot read message content.

### Information opacity

All scope failures return `not_found` — never `permission_denied` or any other
error that would confirm the message exists. This prevents probing: an attacker
cannot distinguish "message does not exist" from "message exists but you cannot
see it." The error response is identical in both cases.

This is a deliberate design choice. Leaking message existence is a form of
metadata exposure. An attacker who can confirm message IDs exist in a
conversation gains information about activity patterns, even without reading
content.

### Admin path

Admin-authenticated callers (no `credentialId` in context) still undergo
chatId ↔ groupId validation. They cannot fish for messages across conversations
by passing mismatched IDs. However, admins are not currently subject to
credential scope checks — they can read any message in a conversation they
specify.

This is an interim state. The full admin message access model requires
owner-approved elevation via the biometric gate (see Privilege elevation below).
Until that is implemented, the admin socket is local-only and admin auth tokens
are short-lived.

## Privilege elevation

An admin can request elevated access (e.g., read access to an operator's
messages). This requires owner approval via Secure Enclave biometric gate:

1. Admin requests elevation
2. Signet creates a pending elevation request
3. Owner is prompted for biometric confirmation (Touch ID / Face ID)
4. On approval: admin receives a time-bound, scoped read credential — logged
   in audit trail with timestamp, scope, and approver. Credential expires
   automatically.
5. On denial: request logged, admin notified, no access granted

When implemented, granting admin message read access will require an
intentionally obnoxious flag (e.g., `--dangerously-allow-message-read`) to
trigger biometric confirmation, audit log entry, seal republish with admin
read access disclosed, and time-bound expiry. No hidden surveillance.

> **Status:** Privilege elevation is designed but not yet implemented in the
> v1 CLI. The biometric gate requires Secure Enclave integration.

Properties of elevated credentials:

- **Explicit** — requires a deliberate request, not implicit
- **Audited** — every elevation is logged (request, approval/denial, scope,
  expiry)
- **Time-bound** — the read credential expires automatically
- **Owner-approved** — biometric confirmation via Secure Enclave, cannot be
  bypassed
- **Scoped** — grants access to specific operators/chats, not blanket access
- **Seal-disclosed** — the seal is republished to show admin read access is
  active

## Threat model

The signet concentrates trust in the runtime and its host. Here is what each
layer protects against.

### Compromised harness

What they gain: nothing beyond the current credential's scope. The harness has
no raw signer, no DB encryption key, no direct XMTP SDK access. The attacker
can abuse the agent's currently granted actions and read whatever the
credential exposes, but cannot escalate beyond the credential's permissions.

This is the scenario the architecture is specifically designed to contain — and
the primary improvement over the current model where a compromised harness has
full client access.

### Compromised host (local)

What they gain: access to operational keys and the raw DB, but not the root
signing key if it is stored in the Secure Enclave. The attacker can read raw
messages and abuse the operational key for routine signing, but cannot perform
privilege escalation (which requires biometric authentication) and cannot
extract the root key from hardware.

On platforms without hardware-backed key storage, a compromised local machine
means full access including all key material.

### Compromised host (self-hosted / managed)

What they gain: full raw message access for all agents the signet manages, all
signer material, and the ability to forge seals. The hosted environment is the
real client boundary, and compromise of it is equivalent to owning every agent
on that signet.

Mitigations: short-lived credentials limit exposure window, mandatory
credential expiry forces periodic renewal, the seal chain creates a forensic
trail. Runtime attestation (TEE-backed) can detect environment tampering in
future phases.

### Malicious operator (managed deployment)

What they gain: the same access as a compromised host, plus the ability to
operate covertly over time. A malicious managed signet operator can silently
exfiltrate messages, forge seals, and impersonate agents.

Mitigations: the seal's trust tier discloses the hosting mode, allowing clients
to render appropriate trust indicators. Build provenance verification provides
a cross-check. But fundamentally, a managed signet requires trust in the
operator — the system is honest about that.

### Network adversary

What they gain: limited value. XMTP messages are encrypted in transit via MLS.
The attacker cannot read message contents. They may observe metadata (who is
communicating, when, message sizes) to the extent XMTP's transport layer
exposes it, but the signet does not change this posture relative to the current
model.

## Trust tiers

The seal includes a trust tier that honestly reflects the security posture:

- **`source-verified`** — root key is hardware-backed (Secure Enclave / TPM)
- **`unverified`** — software vault (no hardware binding)

Group participants can see whether the signet's security claims are backed by
hardware or just software promises.

Future tiers may include:

- **`reproducibly-verified`** — independent parties have reproduced the
  artifact bit-for-bit from source
- **`runtime-attested`** — hosted runtime proves measurement via TEE remote
  attestation

## Verifier pipeline

The signet includes an independent verifier — a multi-check pipeline that
validates seal trust. Checks include:

1. **Source availability** — is the signet's source code accessible?
2. **Build provenance** — does the artifact trace to a known build pipeline?
3. **Signing chain** — does the Ed25519 signature verify against the key
   fingerprint?
4. **Seal chain integrity** — do timestamps move forward monotonically? Do
   operator, credential, and chat IDs match between links? Does the stored
   delta match the recomputed difference?
5. **Schema compliance** — does the seal payload conform to the expected schema?

Multiple independent verifiers can coexist. The verifier identity is just an
XMTP inbox — the decentralization path is baked in from day one. No single
verifier has authority over the ecosystem.

## Revocation

Revocation is immediate, visible, and fail-closed.

### Normal revocation

The admin revokes the credential. The signet immediately:

1. Marks the credential as revoked
2. Enters the WebSocket connection into a draining phase (no new requests,
   cancel in-flight)
3. Closes the connection
4. Publishes a revocation seal to every chat the credential covered
5. Permanently marks the credential-chat pair as revoked

### In-flight messages

If the agent has a message in transit when revocation hits, it is dropped.
A message that arrives after the revocation seal was published never reaches
the group. Better to lose a message than to have an agent act after its
permissions were pulled.

### Credential expiry

If a credential expires without explicit revocation, the connection is closed
with a `credential.expired` event. The harness can re-authenticate with a
renewed credential if the admin issues one. No revocation seal is published
for natural expiry.

### Owner loses access

If the owner's device is lost or the owner leaves the group:

- **Mandatory expiration:** credentials have an `expiresAt` field. A signet
  with no owner contact eventually stops being authorized.
- **Group admin override:** group admins can remove the agent's inbox at the
  XMTP group permissions level, which kills access regardless of what the
  signet thinks.

## Future directions

- **Secure Enclave key binding** — hardware-backed root key via the Swift CLI
  (`signet-signer/`)
- **OWS plugin provider** — external wallet integration for key management
- **Structured egress disclosure** — `inferenceMode`, `inferenceProviders`,
  `contentEgressScope`, and `retentionAtProvider` as required seal fields
- **Build provenance** — Sigstore/SLSA verification in the verifier pipeline
- **Runtime attestation** — TEE-backed measurement for hosted deployments
- **Key rotation** — operational key rotation without session disruption,
  group-visible rotation attestations
