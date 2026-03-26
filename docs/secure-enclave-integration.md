# Secure Enclave Integration

This document describes the Secure Enclave integration primitives in
`@xmtp/signet-keys` and the current runtime model for protecting persisted
vault secret material and gating privileged key lifecycle operations. The
daemon/runtime boot path now consumes the Secure Enclave-backed vault provider
through the compat key manager's encrypted vault storage. Broader policy-level
gates such as scope or egress expansion still require separate runtime wiring.
For the broader key hierarchy and threat model, see [security.md](security.md).

## Overview

The Secure Enclave (SE) integration is split into two independent primitives:

1. **Vault secret protection primitive** — the 32-byte secret that encrypts the vault
   is itself encrypted by an SE key. The secret never exists on disk in
   plaintext. Decrypting it requires the SE hardware.

2. **Biometric gate primitive for privileged operations** — a separate SE key with
   biometric policy gates operations like scope expansion, egress changes,
   and key rotation. Touch ID fires on each gated operation.

Two SE keys, two purposes:

| Key | Purpose | SE key type | Policy | Created when |
|-----|---------|-------------|--------|-------------|
| Vault key | Encrypt/decrypt vault secret | P256.KeyAgreement | Configurable (open/passcode/biometric) | First vault secret resolution |
| Gate key | Authorize privileged operations | P256.Signing | Always biometric | First gated operation |

## Vault Secret Protection

### The problem

The vault uses scrypt + AES-256-GCM to encrypt wallet mnemonics and key
material. That encryption requires a passphrase (or more precisely, a
32-byte secret). Without the SE, this secret lives in a file on disk with
`0o600` permissions — better than an env var, but still extractable by
anyone with access to the filesystem.

### The solution: ECIES with SE key agreement

On SE-capable platforms, the vault secret is protected using ECIES
(Elliptic Curve Integrated Encryption Scheme) with the SE's P-256 key
agreement capability.

#### First run (encrypt)

```text
1. Create P256.KeyAgreement key in SE (configurable policy)
   → SE returns: key reference + public key
   → Key reference persisted to disk (opaque handle, not the private key)

2. Generate random 32-byte vault secret in memory

3. Encrypt vault secret (pure software, no SE needed):
   a. Generate ephemeral P256 key pair
   b. ECDH(ephemeral_private, se_public_key) → shared secret
   c. HKDF-SHA256(shared_secret, salt, info) → AES-256 key
   d. AES-GCM encrypt(vault_secret, aes_key) → ciphertext + nonce + tag

4. Store sealed box to disk:
   { ephemeralPublicKey, nonce, ciphertext, tag }

5. Zeroize the temporary byte buffer after sealed-box creation

6. Return the vault secret to the caller
```

The vault secret itself is never written to disk. Only the sealed box is
persisted — it's useless without the SE private key.

#### Subsequent runs (decrypt)

```text
1. Load key reference from disk
2. Load sealed box from disk

3. Decrypt vault secret (requires SE):
   a. SE does ECDH(se_private_key, ephemeral_public_key) → shared secret
      ← This is where Touch ID fires if biometric policy
   b. HKDF-SHA256(shared_secret, salt, info) → AES-256 key
   c. AES-GCM decrypt(ciphertext, aes_key) → vault secret

4. Return the vault secret to the caller
```

#### Why ECIES, not sign-and-derive?

The SE's P-256 signing uses random nonces (not RFC 6979 deterministic
nonces). Signing the same data twice produces different signatures. This
means a sign-and-derive approach cannot stably reproduce the same vault
secret across restarts.

ECIES avoids this entirely: the vault secret is a random value encrypted
once and decrypted on each run. The SE's role is key agreement (ECDH),
which is deterministic for the same key pair and ephemeral public key.

### Configurable policy

The vault SE key's access policy controls the UX for vault unlock:

| Policy | First run | Daemon start | Unattended restart |
|--------|-----------|--------------|-------------------|
| `open` | Touch ID once (key creation) | Silent | Yes |
| `passcode` | Touch ID once | Device passcode | No |
| `biometric` | Touch ID once | Touch ID | No |

The default is `open` — the SE key is hardware-bound and non-exportable
regardless of policy. Even with `open`, the vault secret can only be
derived by the SE hardware on this specific machine.

`biometric` or `passcode` should be used in deployments where physical
presence is required at every cold start.

Configuration:

```toml
[keys]
vaultKeyPolicy = "open"  # "open" | "passcode" | "biometric"
```

## Biometric Gate for Privileged Operations

Separately from vault unlock, certain operations can require Touch ID
confirmation. This uses a second SE key with `biometric` policy.

The current runtime wiring applies this gate to compat key lifecycle
operations such as root key creation, agent/operational key creation, and
operational key rotation. Scope- and egress-expansion gate toggles remain
part of the broader intended model, but are not yet consumed by a runtime
code path.

### Gated operations

Configurable per-operation:

```toml
[biometricGating]
rootKeyCreation = true
operationalKeyRotation = true
scopeExpansion = true
egressExpansion = true
agentCreation = false
```

When a gated operation fires:

1. Load the gate key reference (created on first gated operation)
2. SE signs an operation-specific challenge — Touch ID prompt fires
3. If confirmed: operation proceeds
4. If cancelled: `CancelledError` returned, operation blocked

### Fail-closed semantics

If biometric gating is configured but the platform does not support the
SE (Linux, Intel Mac, missing signer binary), the gate **fails closed**:
gated operations return an error instead of silently succeeding. This
prevents a configuration that expects biometric enforcement from being
silently bypassed on an unsupported platform.

On platforms without SE, to run without biometric gating, keep all gate
toggles disabled (the defaults).

## Software Fallback

On platforms without Secure Enclave support:

- **Vault secret**: generated randomly and stored in a file with `0o600`
  permissions. Same security as a typical encryption key file.
- **Biometric gate**: no-op if all toggles are disabled (default).
  Returns error if any toggle is enabled (fail-closed).
- **Trust tier**: reported as `unverified` in seals, honestly reflecting
  the software-only posture.

## Swift CLI Changes

The `signet-signer` Swift CLI gains two capabilities:

### `create --purpose key-agreement`

Creates a `P256.KeyAgreement.PrivateKey` in the SE instead of a
`P256.Signing.PrivateKey`. The response format is identical:

```json
{
  "keyRef": "<base64 data representation>",
  "publicKey": "<hex uncompressed P-256 public key>",
  "policy": "open"
}
```

The `--purpose` flag defaults to `signing` for backward compatibility.

### `decrypt`

Performs the SE-side ECDH + HKDF + AES-GCM decryption:

```bash
signet-signer decrypt \
  --key-ref <base64> \
  --ephemeral-pub <hex> \
  --nonce <hex> \
  --ciphertext <hex> \
  --tag <hex> \
  --format json
```

Response:

```json
{
  "plaintext": "<hex>"
}
```

The command:

1. Loads the SE key from the data representation
2. Imports the ephemeral public key
3. Performs ECDH → shared secret (biometric prompt fires here if policy
   requires it)
4. HKDF-SHA256(shared_secret, "signet-vault-ecies", 32) → AES key
5. AES-GCM decrypt(ciphertext, nonce, tag, aes_key) → plaintext
6. Returns hex-encoded plaintext

## TypeScript Bridge Changes

### `seEncrypt(publicKeyHex, plaintext)` — pure TypeScript

Encrypts using `@noble/curves` P-256 ECDH + `@noble/hashes` HKDF +
`@noble/ciphers` AES-GCM. No subprocess, no SE needed.

Returns:

```typescript
{
  ephemeralPublicKey: string;  // hex
  nonce: string;               // hex
  ciphertext: string;          // hex
  tag: string;                 // hex
}
```

### `seDecrypt(keyRef, sealedBox, signerPath)` — bridge to Swift CLI

Calls `signet-signer decrypt` with the sealed box components. Returns
the decrypted plaintext bytes.

### Protocol schemas

```typescript
const SeDecryptResponseSchema = z.object({
  plaintext: z.string(),
});

const SealedBoxSchema = z.object({
  ephemeralPublicKey: z.string(),
  nonce: z.string(),
  ciphertext: z.string(),
  tag: z.string(),
});
```

## VaultSecretProvider

Replaces the earlier `PassphraseProvider` concept:

```typescript
interface VaultSecretProvider {
  /** Resolve the vault encryption secret. May prompt for biometric. */
  getSecret(): Promise<Result<string, SignetError>>;
  /** Which provider backs this. */
  readonly kind: "secure-enclave" | "software";
}
```

### SE implementation

- First run: `seCreate` (key-agreement) → generate random secret →
  `seEncrypt` → persist sealed box + key ref
- Subsequent runs: load key ref + sealed box → `seDecrypt` → vault secret

### Software implementation

- First run: generate random secret → write to file with `0o600`
- Subsequent runs: read from file

### Factory

```typescript
function resolveVaultSecretProvider(
  dataDir: string,
  policy?: KeyPolicy,
): VaultSecretProvider
```

Auto-selects SE or software based on `detectPlatform()`. The `policy`
parameter controls which SE access policy is used for the vault key
(default: `open`).

## Machine Migration (Future)

The ECIES design supports clean machine migration:

```text
Old machine                          New machine
───────────                          ───────────
SE decrypts vault secret             Create new SE key
     ↓                                    ↓
vault secret in memory ──transfer──> vault secret in memory
     ↓                                    ↓
                                     seEncrypt with new SE key
                                     new sealed box on disk

Vault data files copy as-is (encrypted with the vault secret)
```

The transfer uses a passphrase-encrypted bundle:

```bash
# Old machine (Touch ID if biometric policy)
xs export --to migration.signet

# New machine (Touch ID to create new SE key + passphrase to decrypt bundle)
xs import migration.signet
```

**Preserved:** wallet mnemonics, operator configs, storage partitions,
XMTP inbox continuity (via installation rotation).

**Not preserved:** SE key references (new hardware), active credentials
(reissued), active seals (republished).

The vault secret transitions: SE-protected (old) → passphrase-protected
(bundle) → SE-protected (new). Never on disk in plaintext at any point.

## File Layout

```text
dataDir/
  secrets/                 # encrypted compat key-manager secret entries
    admin-key.bin
    admin-key-pub.bin
    db-key%3A<identity>.bin
    xmtp-identity-key%3A<identity>.bin
  se-vault-keyref          # base64 SE key data representation
  vault-sealed-box.json    # { ephemeralPublicKey, nonce, ciphertext, tag }
  se-gate-keyref           # base64 SE gate key data representation (created on first gated op)
  vault-passphrase         # software fallback only (0o600, not present on SE platforms)
  kv/                      # legacy compat layout, lazily migrated into secrets/
```

## Testing Strategy

### Deterministic (always run)

- Mock signer scripts simulate the SE CLI protocol
- Test encrypt → decrypt round-trip using pure TypeScript ECIES
- Test sealed box persistence and reload
- Test fail-closed gate on non-SE platforms
- Test error handling for all failure paths

### Live SE (opt-in via `SIGNET_RUN_LIVE_SE_TESTS=1`)

- Real SE key creation with `key-agreement` purpose
- Real encrypt → decrypt round-trip through hardware
- Real biometric gate (requires `open` policy in CI, `biometric` locally)
- Verify vault secret stability across provider instances
