# OWS Integration Plan

Status: **Draft**
Last updated: 2026-03-23

## Overview

[Open Wallet Standard (OWS)](https://github.com/open-wallet-standard/core) is a local-first, policy-gated wallet specification with encrypted key custody, multi-chain signing, and pre-signing policy enforcement. v1.0.0 released 2026-03-23. Rust core with Node.js bindings via NAPI.

This document proposes adopting OWS as the key management and signing foundation for xmtp-signet, replacing the current `packages/keys/` implementation.

## Why OWS

### Current State (packages/keys/)

The signet's current key management:
- Software vault using `bun:sqlite` for encrypted key storage
- Ed25519 key generation via WebCrypto
- P-256 via Secure Enclave bridge (macOS only)
- secp256k1 via `@noble/curves` for XMTP identity keys
- Custom operational key manager with rotation support
- Session key issuance and revocation
- No memory-safe key handling (no zeroize)
- No pre-signing policy enforcement
- No standard wallet file format

### What OWS Provides

| Concern | Current (packages/keys/) | OWS |
|---------|-------------------------|-----|
| Key storage | SQLite-based software vault | Encrypted JSON files (Keystore v3 extended), AES-256-GCM |
| Key derivation | Manual per-key generation | BIP-39 mnemonic → BIP-44 derivation (one seed, all chains) |
| Encryption at rest | Custom AES via @noble/ciphers | scrypt + AES-256-GCM (wallet files), HKDF + AES-256-GCM (API keys) |
| Signing | WebCrypto + @noble/curves | Rust-native signers with memory wipe (zeroize) |
| Curves | Ed25519, P-256, secp256k1 (separate impls) | Ed25519, secp256k1 (unified, BIP-44 derived) |
| Agent access | Session tokens with manual scope checks | API keys as encrypted capabilities (token = decryption key via HKDF) |
| Policy enforcement | Grant config checked in handler layer | Pre-signing policy engine (declarative rules + executable evaluators) |
| Audit logging | Custom JSONL audit log | Built-in append-only JSONL audit log |
| Memory safety | None | zeroize after every signing operation |
| Platform support | macOS SE + software fallback | Cross-platform (Rust core, same behavior everywhere) |
| Multi-chain | secp256k1 (XMTP) + Ed25519 (seals) + P-256 (SE) | 8 chains with standard derivation paths |
| Wallet interop | None (proprietary format) | Ethereum Keystore v3 compatible, importable/exportable |
| File permissions | Not enforced | Enforced (700/600 on secret directories) |

### What OWS Does Not Cover

The signet still owns everything above the key/signing layer:

- XMTP protocol integration (MLS, inboxes, conversations)
- Operator/admin/superadmin role hierarchy
- Seal protocol (publishing, chaining, transparency, message binding)
- Credential lifecycle beyond the key material
- CLI surface, action registry, transport adapters
- Conversation-scoped inbox management
- Network ID mapping and local ID system

## Wallet vs Key Distinction

Wallets and keys are separate concerns:

```
Wallet (source material — mnemonic, BIP-39 seed)
  │  Managed by: signet (internal) or OWS tools (ows provider)
  │  Lives at: ~/.xmtp/signet/wallets/ or ~/.ows/wallets/
  │
  └─ derives → Key (signet-specific, purpose-bound)
                │  Managed by: signet always
                │  Lives at: signet's runtime state
                │
                ├─ identity key    (XMTP inbox registration, secp256k1)
                ├─ operational key (seal signing, Ed25519)
                └─ credential key  (token binding, HKDF-derived)
```

- `xs wallet` — about the source material and where it lives (provider, path, accounts)
- `xs key` — about what the signet has derived and actively uses (tier, purpose, rotation)
- One wallet can back multiple operators, each with their own derived keys
- The signet never exposes wallet-level secrets — only uses them internally for derivation

## Concept Mapping

### OWS → Signet

| OWS Concept | Signet Concept | Relationship |
|-------------|---------------|--------------|
| Wallet | Operator's key material | One OWS wallet per operator. The wallet's mnemonic derives all keys for that operator's inboxes. |
| Account | Inbox's signing identity | Each XMTP inbox maps to a derived account (chain: EVM for XMTP identity, Ed25519 for message signing). |
| API Key | Credential | One OWS API key per signet credential. The token is the capability — presented by the harness, used to decrypt a scoped copy of the wallet secret. |
| Policy | Permission scopes | OWS policies enforce the signet's `--allow`/`--deny` scopes at the signing layer. |
| Owner mode | Owner (biometric/passphrase) | Passphrase or passkey unlocks the wallet. Maps to the signet owner's biometric gate. |
| Agent mode | Operator with credential | API key token presented by the operator/harness. Policy engine evaluates before signing. |
| Vault directory | Data directory | `~/.ows/` nested inside or alongside the signet's data directory. |
| Audit log | Signet audit log | OWS audit events merge with signet audit events into a unified log. |

### Detailed Mappings

#### Wallet ↔ Operator

```
xs operator create --label "alice-bot"
  → OWS: createWallet("alice-bot", ownerPassphrase)
  → Returns: WalletInfo { id: "op_a7f3...", name: "alice-bot", accounts: [...] }

xs operator rm alice-bot --force
  → OWS: deleteWallet("alice-bot")
  → Destroys encrypted mnemonic and all derived key material
```

One operator = one OWS wallet = one BIP-39 mnemonic. The mnemonic can derive keys for any chain at any index, so a single wallet supports multiple inboxes via different derivation paths.

#### Account ↔ Inbox

```
xs inbox create --label "support" --op alice-bot
  → OWS: deriveAddress(walletMnemonic, "evm", nextIndex)
  → New account added to wallet's accounts array
  → Account registered as XMTP inbox

xs inbox rm support --force
  → Account removed from wallet (mnemonic unchanged, derivation path freed)
```

Each inbox is a derived account at a specific BIP-44 index. Per-chat scope operators get a new index per chat. Shared scope operators reuse one index across chats.

XMTP identity registration requires a secp256k1 key (EVM-compatible). OWS derives this at `m/44'/60'/0'/0/{index}` — standard EVM derivation.

For Ed25519 signing (seals, message provenance), a parallel derivation at a Solana or custom path provides Ed25519 keys from the same mnemonic.

#### API Key ↔ Credential

```
xs cred issue --op alice-bot --chat conv_1 --allow send,react
  → OWS: createApiKey(
      name: "cred_b2c1",
      walletIds: ["alice-bot-wallet-id"],
      policyIds: ["policy-send-react-conv1"],
      passphrase: ownerPassphrase,
      expiresAt: ttlTimestamp
    )
  → Returns: { token: "ows_key_<64hex>", id: "cred_b2c1", name: "cred_b2c1" }
  → Token given to harness (shown once, never stored by signet)

xs cred revoke cred_b2c1 --force
  → OWS: revokeApiKey("cred_b2c1")
  → Key file deleted — encrypted mnemonic copies destroyed
  → Original wallet and other credentials unaffected
```

The OWS API key token IS the credential. The harness presents it to sign messages. OWS uses HKDF-SHA256 to derive a decryption key from the token, decrypts the wallet mnemonic copy, signs, then wipes.

**Critical security property**: revoking a credential (deleting the API key file) destroys the encrypted mnemonic copy. The token becomes useless — even if leaked, there's nothing left to decrypt.

#### Policy ↔ Permission Scopes

```
xs cred issue --op alice-bot --chat conv_1 --allow send,react --deny invite

  → OWS policy created:
  {
    "id": "policy-cred-b2c1",
    "name": "alice-bot / conv_1 / send,react",
    "version": 1,
    "rules": [
      { "type": "allowed_chains", "chain_ids": ["eip155:dev"] },
      { "type": "expires_at", "timestamp": "2026-03-24T10:00:00Z" }
    ],
    "action": "allow",
    "executable": "/path/to/signet-policy-evaluator"
  }
```

OWS's built-in policy rules handle:
- **Chain allowlisting** — restrict to XMTP's chain
- **Expiry** — credential TTL
- **Spending limits** — not directly applicable but available for future token operations

The signet's granular permission scopes (`send`, `react`, `invite`, `read-messages`, etc.) are too domain-specific for OWS's built-in rules. These are handled by a **custom policy executable** — a script/binary that OWS calls before signing:

```
Signet Policy Evaluator (executable):
  Input (stdin): { chain_id, wallet_id, api_key_id, transaction, timestamp }
  Logic:
    1. Look up credential by api_key_id
    2. Parse the transaction to determine the operation type (send, react, etc.)
    3. Check operation against credential's allow/deny scopes
    4. Check chat scope (is this transaction for an allowed conversation?)
    5. Return { allowed: true } or { allowed: false, reason: "..." }
```

This is OWS's extensibility mechanism — declarative rules for simple checks, executable evaluators for domain-specific logic.

## Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────┐
│  CLI / HTTP / WS / MCP  (transport layer)   │
├─────────────────────────────────────────────┤
│  Action Registry  (transport-agnostic)       │
├─────────────────────────────────────────────┤
│  Signet Domain Logic                         │
│  ┌───────────┬──────────┬─────────────────┐ │
│  │ Operators │ Chats    │ Seals           │ │
│  │ Inboxes   │ Messages │ Credentials     │ │
│  └───────────┴──────────┴─────────────────┘ │
├─────────────────────────────────────────────┤
│  OWS Integration Layer  (packages/keys/)     │
│  ┌───────────────────────────────────────┐  │
│  │ Wallet ↔ Operator mapping             │  │
│  │ Account ↔ Inbox mapping               │  │
│  │ API Key ↔ Credential mapping          │  │
│  │ Policy ↔ Permission scope mapping     │  │
│  │ Signet Policy Evaluator (executable)  │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  OWS Core  (@open-wallet-standard/core)      │
│  ┌───────────────────────────────────────┐  │
│  │ Encrypted vault (~/.ows/)             │  │
│  │ BIP-39/44 key derivation              │  │
│  │ Multi-chain signers (Rust/NAPI)       │  │
│  │ Policy engine (rules + executables)   │  │
│  │ API key management (HKDF tokens)      │  │
│  │ Audit logging                         │  │
│  │ Memory-safe signing (zeroize)         │  │
│  └───────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  XMTP SDK  (@xmtp/node-sdk)                 │
│  MLS / Group Management / Message Streaming  │
└─────────────────────────────────────────────┘
```

### Storage Layout

```
~/.xmtp/signet/
  config.toml                              # Signet configuration
  ows/                                     # OWS vault (delegated)
    config.json
    wallets/
      <op-uuid>.json                       # One encrypted wallet per operator
    keys/
      <cred-uuid>.json                     # One API key per credential
    policies/
      <policy-uuid>.json                   # One policy per credential scope
    logs/
      audit.jsonl                          # OWS audit events
  operators/
    <op-uuid>/
      metadata.json                        # Operator config (role, scope, label)
      inboxes/
        <inbox-uuid>/
          metadata.json                    # Inbox config (label, linked chat)
          messages.db                      # Encrypted message store (MLS keys)
          mls-state/                       # XMTP MLS group state
  seals/
    active/
      <seal-uuid>.json                     # Current seal per operator+chat
    history/
      <seal-uuid>.json                     # Historical seals
  logs/
    audit.jsonl                            # Signet audit events (merged with OWS)
  id-map.db                               # xmtp_ ↔ local ID mapping
```

### Key Derivation Strategy

One BIP-39 mnemonic per operator, deriving all needed key types:

```
Mnemonic (24 words, encrypted in OWS wallet file)
  │
  ├── m/44'/60'/0'/0/0   → secp256k1 (XMTP identity key for inbox 0)
  ├── m/44'/60'/0'/0/1   → secp256k1 (XMTP identity key for inbox 1)
  ├── m/44'/60'/0'/0/N   → secp256k1 (XMTP identity key for inbox N)
  │
  ├── m/44'/501'/0'/0'   → Ed25519 (seal signing key)
  ├── m/44'/501'/1'/0'   → Ed25519 (operational key for inbox 0)
  ├── m/44'/501'/N'/0'   → Ed25519 (operational key for inbox N)
  │
  └── (future chains as needed)
```

**Benefits of single-mnemonic derivation:**
- One encrypted blob per operator (simple backup/restore)
- Deterministic — same mnemonic always produces same keys
- New inboxes don't require new key generation, just increment the index
- Wallet export/import moves the entire operator

**Per-chat scope**: each chat gets a unique inbox at the next derivation index. The mapping between index and chat is stored in the inbox metadata.

**Shared scope**: one inbox (index 0) used for all chats.

### Credential Flow

```
1. Admin issues credential:
   xs cred issue --op alice-bot --chat conv_1 --allow send,react

2. Signet creates OWS policy from permission scopes:
   → Policy file: rules + path to signet policy evaluator

3. Signet creates OWS API key scoped to operator's wallet + policy:
   → OWS re-encrypts mnemonic under HKDF(token)
   → Token returned (shown once): "ows_key_<64hex>"

4. Token delivered to harness (via session establishment)

5. Harness wants to sign a message:
   → Presents token to OWS signMessage()
   → OWS verifies token hash against stored key file
   → OWS evaluates policies:
     a. Built-in rules (chain allowlist, expiry)
     b. Executable evaluator (signet permission scopes, chat scope)
   → If policies pass: decrypt mnemonic via HKDF(token), derive key, sign, wipe
   → If policies fail: return POLICY_DENIED, no key material touched

6. Credential revocation:
   xs cred revoke cred_b2c1 --force
   → OWS: delete key file → encrypted mnemonic copy destroyed
   → Token becomes useless (nothing to decrypt)
```

### Privilege Elevation Flow

```
1. Superadmin requests read access:
   xs cred issue --op lobster-bot --dangerously-allow-message-read --chat conv_1

2. Biometric gate triggered (Secure Enclave / passkey)

3. If approved:
   → Create OWS API key for lobster-bot scoped to alice-bot's wallet
   → Policy includes: read-only, time-bound, specific chat
   → Key file stores re-encrypted copy of alice-bot's mnemonic under lobster-bot's token
   → Seal republished with admin read access disclosed

4. On expiry:
   → Key file auto-deleted (or marked expired, next access denied)
   → Seal republished removing admin access disclosure
```

## Integration Points

### packages/keys/ Refactor

The current `packages/keys/` becomes a thin adapter over OWS:

| Current Component | OWS Replacement |
|------------------|----------------|
| `createVault()` | OWS vault initialization (`~/.xmtp/signet/ows/`) |
| `createOperationalKeyManager()` | OWS wallet creation + account derivation |
| `createSessionKeyManager()` | OWS API key creation |
| `createAdminKeyManager()` | OWS wallet with admin policy |
| `createSealStamper()` | OWS signMessage() with Ed25519 path |
| `createSignerProvider()` | OWS signMessage() / signTransaction() |
| `initializeRootKey()` | OWS createWallet() with passphrase/passkey |
| `rotateOperationalKey()` | Derive next index from same mnemonic |
| `BiometricGate` | Owner passphrase/passkey check before OWS owner-mode operations |

### What Changes

**Removed:**
- `packages/keys/src/vault.ts` — replaced by OWS vault
- `packages/keys/src/crypto-keys.ts` — replaced by OWS Rust signers
- `packages/keys/src/operational-key.ts` — replaced by OWS wallet + derivation
- `packages/keys/src/session-key.ts` — replaced by OWS API keys
- `packages/keys/src/root-key.ts` — replaced by OWS wallet creation
- Dependencies: `@noble/curves`, `@noble/hashes`, `@noble/ciphers` (signing moves to Rust)

**Kept:**
- `packages/keys/src/key-manager.ts` — refactored to delegate to OWS
- `packages/keys/src/config.ts` — updated with OWS vault path config
- `packages/keys/src/se-bridge.ts` — still needed for macOS Secure Enclave passkey
- `packages/keys/src/biometric-gate.ts` — gates owner-mode access to OWS

**Added:**
- `packages/keys/src/ows-adapter.ts` — maps signet concepts to OWS API calls
- `packages/keys/src/policy-evaluator.ts` — signet policy executable for OWS policy engine
- Dependency: `@open-wallet-standard/core` (NAPI binding)

### Signet Policy Evaluator

A standalone script that OWS calls before signing. It bridges OWS's generic policy engine with the signet's domain-specific permission model:

```typescript
// packages/keys/src/policy-evaluator.ts
// Called by OWS as an executable policy evaluator

// Input: PolicyContext from stdin
// Output: { allowed: boolean, reason?: string } to stdout

interface SignetPolicyContext {
  chain_id: string;
  wallet_id: string;      // → resolve to operator
  api_key_id: string;     // → resolve to credential
  transaction: string;    // → parse to determine operation type
  timestamp: string;
}

// 1. Resolve credential from api_key_id
// 2. Parse transaction to determine operation (send, react, etc.)
// 3. Check operation against credential's allow/deny scopes
// 4. Check chat scope (is this for an allowed conversation?)
// 5. Return decision
```

## Migration Strategy

### Phase 1: Parallel Operation

1. Add `@open-wallet-standard/core` as a dependency
2. Create `ows-adapter.ts` that wraps OWS for wallet/key/API-key operations
3. Implement `policy-evaluator.ts` for permission scope checking
4. New operators created via OWS; existing operators continue on legacy vault
5. Tests run against both backends

### Phase 2: Migration

1. Migration tool: read legacy vault keys, create OWS wallets with imported keys
2. Re-encrypt all key material under OWS format
3. Generate OWS API keys for existing credentials
4. Verify signing produces identical results
5. Switch default backend to OWS

### Phase 3: Cleanup

1. Remove legacy vault code
2. Remove `@noble/curves`, `@noble/hashes`, `@noble/ciphers` dependencies
3. Update Secure Enclave bridge to work with OWS passkey flow
4. Update documentation

## Security Considerations

### Improvements Over Current

- **Memory-safe signing**: OWS Rust core uses `zeroize` to wipe key material after every operation. Current JS implementation has no memory safety guarantees.
- **Enforced file permissions**: OWS checks 700/600 on vault directories at startup. Current implementation doesn't enforce.
- **Standard encryption**: Keystore v3 + AES-256-GCM is well-audited. Current implementation uses correct primitives but in a custom format.
- **Token-as-capability**: HKDF-derived decryption from API key token is cryptographically stronger than the current session token model.
- **Policy-before-decrypt**: OWS evaluates policies before any key material is decrypted. Current implementation checks permissions after key operations.

### Considerations

- **NAPI dependency**: The Node.js binding requires a native module compiled for each platform. Bun's NAPI compatibility needs verification.
- **New dependency surface**: OWS is a new project (v1.0.0). The Rust core is well-structured but hasn't had years of production hardening.
- **BIP-39 mnemonic model**: Different from the current per-key generation. Migration requires care to not lose key material.
- **Passphrase management**: OWS requires a passphrase for owner mode. Need to define how this integrates with the Secure Enclave biometric flow — likely the SE stores/releases the passphrase.

### Secure Enclave Integration

The SE bridge can work with OWS by storing the vault passphrase in the Secure Enclave:

```
xs init
  1. Generate random vault passphrase (high entropy)
  2. Store passphrase in Secure Enclave (biometric-protected)
  3. Use passphrase to create first OWS wallet
  4. Passphrase never exposed to user — biometric unlocks it

Signing flow:
  1. Owner operation requested
  2. Biometric gate: SE releases passphrase
  3. Passphrase passed to OWS for owner-mode operation
  4. Passphrase wiped from memory after operation
```

This preserves the "no passphrase to remember" UX while using OWS's passphrase-based encryption under the hood.

## Bun Compatibility

OWS's Node.js binding uses NAPI (N-API), which Bun supports. Verification needed:

```bash
# Test: can Bun load the OWS NAPI module?
bun add @open-wallet-standard/core
bun -e "const ows = require('@open-wallet-standard/core'); console.log(ows.generateMnemonic())"
```

If NAPI works: direct integration.
If NAPI fails: options are (a) use OWS CLI as a subprocess (like current SE bridge pattern), (b) contribute Bun compatibility to OWS, or (c) use the Rust crate directly via a custom binding.

## Export & Backup

### Export Surface

```
xs export                                # full signet export, passphrase required
xs export --op alice-bot                 # single operator export
xs export --dangerously-export-unencrypted  # no passphrase (obnoxious flag)
```

Export produces a single encrypted blob (scrypt + AES-256-GCM with export passphrase) containing:
- BIP-39 mnemonic(s)
- Operator metadata (role, scope, label)
- Inbox-to-derivation-index mappings
- Credential definitions (not active tokens — regenerated on import)
- Seal history

Import restores deterministically — same mnemonic derives same keys, metadata reconnects them to XMTP identities.

```
xs import <file>                         # prompts for export passphrase
```

### Key Material Safety Invariant

Agents and operators never see raw key material. The NAPI boundary is the security perimeter:
- Rust side: handles all decryption, derivation, signing, memory wipe
- TypeScript side: only sees signatures, public keys, and operation results
- No mnemonic, private key, or derivation input ever crosses into JavaScript memory

## Directory Structure

### XDG Compatibility

```
$XDG_DATA_HOME/xmtp/signet/             # default: ~/.local/share/xmtp/signet/
  ows/                                   # nested OWS vault
  operators/
  seals/
  logs/
  id-map.db

$XDG_CONFIG_HOME/xmtp/signet/           # default: ~/.config/xmtp/signet/
  config.toml

# Legacy-compatible fallback (if XDG not set):
~/.xmtp/signet/
```

### OWS Vault Location

- **Default**: nested at `<data-dir>/ows/`
- **Configurable**: `config.toml` → `[ows] vault_path = "~/.ows/"` to use external vault
- Signet tracks which wallets it has adopted via metadata flags
- External wallets (in `~/.ows/`) are visible but not managed until explicitly adopted

## Wallet Management

### Auto-Detection on Init

```
xs init
  Detected existing OWS vault at ~/.ows/ with 3 wallets:
    - "treasury" (EVM, Solana)
    - "agent-1" (EVM)
    - "personal" (EVM, Bitcoin)
  Would you like to import any of these as operators? [y/n]
```

### Wallet Commands

```
xs wallet list                           # all wallets: internal + external OWS
xs wallet info <id>                      # wallet details, provider, derived accounts
xs wallet provider set <name> --path <path>  # configure provider (e.g., OWS vault path)
xs wallet provider list                  # list configured providers
```

The signet reads from external OWS wallets without copying or modifying them. Wallet lifecycle is managed by OWS tools. The signet is a consumer, not an owner.

## Convos Passkey Research

Convos iOS uses passkeys for identity creation. Research needed on:
- How Convos derives XMTP identity keys from passkeys
- Whether this is compatible with OWS's passphrase model
- How the signet's SE bridge could use passkeys instead of passphrases

Reference: `.reference/convos-ios/` (if available) or Convos documentation.

## Resolved Questions

- [x] **Bun NAPI compatibility** — needs hands-on verification (test soon, not blocking design)
- [x] **BIP-44 paths** — use standard EVM path (`m/44'/60'/0'/0/N`) for XMTP identity keys. XMTP identities are EVM addresses. Custom coin type can be added later if needed.
- [x] **Export/import** — encrypted export with scrypt + AES-256-GCM. Single blob: mnemonic + metadata. Passphrase required by default, `--dangerously-export-unencrypted` for unprotected.
- [x] **Vault location** — nested by default (`<data-dir>/ows/`), configurable to point at external `~/.ows/`. Auto-detect on init.
- [x] **Directory convention** — `~/.xmtp/signet/` with XDG compatibility.

- [x] **Policy evaluator in Docker/serverless** — Docker: bundle evaluator binary in image. Serverless: deferred (Cloudflare adapter is future work).
- [x] **Admin elevation via OWS** — OWS API keys support `wallet_ids` spanning multiple wallets. Elevation creates a cross-wallet API key with short TTL + restrictive policy. OWS handles signing access; signet layer handles MLS read-access semantics above it.

## Security Boundary: Agents Never Touch OWS

**Critical invariant**: agent harnesses never interact with OWS directly. The signet daemon holds all OWS tokens internally. Two separate token systems:

```
Agent harness                    Signet daemon                    OWS vault
     │                                │                               │
     │── signet credential token ──▶  │                               │
     │                                │── OWS API key (internal) ──▶  │
     │                                │                               │── decrypt, sign, wipe
     │                                │◀── signature ─────────────────│
     │◀── result ────────────────────│                               │
```

- Harness token authenticates to the signet
- OWS token authenticates the signet to its own vault
- These are separate systems — an agent cannot reach OWS
- Even if an agent compromises the TypeScript layer, the NAPI/Rust boundary prevents key extraction
- No OWS tokens, wallet references, or vault paths ever leak to agent harnesses

## Signing Orchestration (Future)

The signet can evolve into a **signing orchestrator** — not just for XMTP messaging, but for any chain operation OWS supports. The principle: **never hand out keys, hand out capabilities**.

### Capability Tiers

| Tier | How it works | Example |
|------|-------------|---------|
| **Pre-approved** | Credential's policy auto-approves | XMTP message signing in allowed chats |
| **One-time approval** | Agent requests, admin/owner approves, signet executes once | "Send 0.1 ETH to 0xabc for this task" |
| **Never** | Credential denies or operation not in scope | Rejected immediately |

### One-Time Signing Flow

```
1. Agent: "I need to sign this EVM transaction" (via signet action)
2. Signet: creates a pending signing request
   - Logs the request in audit trail
   - Notifies admin agent (or owner)
3. Admin reviews: sees transaction details, destination, amount, chain
4. Admin approves (or owner via biometric for high-value)
5. Signet: executes single OWS signAndSend()
   - Returns tx hash to agent
   - Logs execution in audit trail
   - Request marked as consumed (one-time, non-replayable)
6. Agent: gets tx hash, never touched a key or OWS token
```

### Seal Disclosure

The seal communicates transaction capabilities to group members:

```
Seal for alice-bot in "Treasury Team":
  XMTP: send, react (pre-approved)
  EVM:  transaction requests (admin-approved, one-time only)
  Max:  0.5 ETH per request
```

Group members know the agent has financial capabilities but they're gated by human approval and disclosed publicly.

### Permission Scopes for Signing Orchestration

Future scopes to add to the `--allow`/`--deny` system:

| Scope | Description |
|-------|-------------|
| `request-sign` | Request a transaction signature (queued for approval) |
| `request-send` | Request a sign-and-broadcast (queued for approval) |
| `auto-sign` | Pre-approved signing for specific chains/amounts (dangerous) |

`auto-sign` would require `--dangerously-allow-auto-sign` and biometric confirmation, similar to `--dangerously-allow-message-read`.

## Codex Review Findings & Responses

Review conducted 2026-03-23. Findings with decisions:

### MLS/Key Separation
**Finding**: OWS manages wallet mnemonics for signing, but reading messages depends on MLS group state (separate from wallet keys). Elevation giving wallet access doesn't grant MLS decryption of past messages.

**Decision**: Acknowledged pre-existing gap — not introduced by OWS. Research how XMTP and Convos CLIs handle MLS state management and add an adaptation layer above OWS wallets. The MLS state lives in the operator's encrypted storage partition, separate from the wallet mnemonic.

### Per-Chat Mnemonics
**Finding**: One mnemonic per operator means all inbox addresses are derivable by index, creating linkability risk.

**Decision**: Not needed. Convos likely uses one mnemonic for all per-group identities. Address derivability doesn't grant access — the signet's abstraction layer above the wallet handles chat isolation. The threat model is about message access, not address correlation.

### Policy Evaluator Contract
**Finding**: No canonical mapping between XMTP signing payloads and chat IDs.

**Decision**: Research the existing XMTP SDK payload structure and our own codebase to determine if chat ID is available at the signing layer. Likely needs an abstraction on top — the signet wraps signing requests with context (chat, operation type) before passing to OWS.

### Token Delivery & Lifecycle
**Finding**: Tokens shown once with no rotation strategy, no secure delivery channel.

**Decision**: Three-layer token separation (from Codex review):

**Layer 1: Admin bootstrap auth** — trusted issuer calls `cred.issue` over Unix admin socket or admin HTTP. Token delivered to harness via inherited env, stdin, or `0600` temp file. Never on command line, never printed by default (`--reveal-token` for dev).

**Layer 2: Harness credential token** — opaque signet-issued token the harness holds. Short-lived, renewable. Stable `cred_id` with rotating bearer secret. Default TTL: 1h local, 15-30min remote. 2-minute overlap window for graceful rotation. Material policy changes force reauth (no transparent renewal).

**Layer 3: OWS backing token** — held exclusively inside the signet daemon, encrypted at rest. Rotated independently, invisible to harness. Never exposed outside the daemon process.

**Additional changes needed:**
- Stop deduplicating sessions by `agentInboxId + policyHash` — each harness instance gets its own token family
- Expose `cred.renew` as a first-class operation on harness plane (HTTP + WS)
- Add `cred.expiring` event on WS for proactive renewal
- For remote harnesses: mTLS or harness public key fingerprint binding (stolen token can't replay from another machine)
- Persist credential metadata to SQLite for daemon-restart survivability

### Credential ID Determinism
**Finding**: After import, credential IDs may change, breaking seal chains.

**Decision**: Credential IDs are deterministic — export/import preserves them. The real concern is transparency during environment migration (local → Docker). The signet should detect and report when the hosting environment changes while IDs stay stable.

### OWS as Plugin, Not Dependency
**Finding**: Daemon compromise with in-process OWS = game over.

**Decision**: OWS is an optional plugin. The signet implements OWS-compatible file formats and conventions using `@noble/*` crypto (pure TypeScript, no native deps). The OWS plugin enables reading from external OWS vaults — the signet never copies or modifies OWS wallet files.

#### Provider Model

Two wallet providers, selectable per-operator:

| Provider | Crypto | Wallet Location | Managed By |
|----------|--------|-----------------|------------|
| `internal` | `@noble/*` (TypeScript) | `~/.xmtp/signet/wallets/` | Signet |
| `ows` | OWS NAPI (Rust) or `@noble/*` fallback | `~/.ows/wallets/` (configurable) | OWS tools |

```
# Global default provider
xs config set wallet.default-provider internal

# Per-operator provider
xs operator create --label alice-bot --provider ows --wallet treasury
xs operator create --label bob-bot --provider internal

# Mixed estate
xs wallet list
  treasury     ows        ~/.ows/wallets/3198bc9c.json
  alice-keys   internal   ~/.xmtp/signet/wallets/op_a7f3.json
```

#### Key Design Principles

- **Signet is a consumer of OWS wallets, not an owner** — never copies, never modifies OWS wallet files
- **OWS wallet lifecycle managed by OWS tools** — the signet just has permission to sign through them
- **Same file format** — internal wallets use OWS-compatible Keystore v3 extended format, so they could be read by OWS tools too
- **Same crypto choices** — scrypt + AES-256-GCM for wallets, HKDF-SHA256 + AES-256-GCM for credential tokens. Same parameters regardless of provider.
- **Plugin off = no OWS access** — signet can't see external wallets, no supply chain risk
- **Plugin on = read-only access** — signet reads from OWS vault at configured path, signs through it
- **`--provider` flag** — available on any command that touches wallets. Defaults to operator's configured provider.

#### Optional Native Upgrade

If `@open-wallet-standard/core` (NAPI) is installed, the `ows` provider uses Rust-native signing with memory safety (zeroize). If not installed, it falls back to `@noble/*` for the same operations. Same file format, same interface, same results — different runtime characteristics.

### Threat Model Widening
**Finding**: Mnemonic exfiltration window while token is valid.

**Decision**: OWS adoption must not widen the threat model. The same security invariants apply regardless of backend. OWS is about standard compatibility, not changing the security posture. Short TTLs and audit logging are the mitigation.

### Seal Delivery Reliability
**Finding**: Automatic republish is best-effort with no retry plan.

**Decision**: Rely on XMTP delivery confirmation. Add retries with deduplication (idempotency key on seal ID + version). Be careful not to spam — exponential backoff with a cap.

### Threat Model Document
**Decision**: Document explicitly. The adapter/plugin architecture gives honest boundaries and an exit strategy. Each backend declares what it can and can't guarantee.

## Open Questions

- [ ] Convos iOS passkey flow — how does it derive XMTP keys, and is it compatible with OWS?
- [ ] Token delivery — secure channel design (pending Codex follow-up)
- [ ] KeyBackend interface design — what's the minimal abstraction that supports both built-in vault and OWS?
