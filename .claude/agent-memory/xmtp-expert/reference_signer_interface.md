---
name: XMTP Node SDK v6 Signer Interface
description: Exact Signer type, IdentifierKind values, and how to create a server-side signer for @xmtp/node-sdk v6. Authoritative sources: signer.ts source + node-bindings d.ts.
type: reference
---

## Signer type (from `@xmtp/node-sdk` v6, re-exported from `sdks/node-sdk/src/utils/signer.ts`)

```ts
type SignMessage = (message: string) => Promise<Uint8Array> | Uint8Array;
type GetIdentifier = () => Promise<Identifier> | Identifier;
type GetChainId = () => bigint;
type GetBlockNumber = () => bigint;

export type Signer =
  | {
      type: "EOA";
      signMessage: SignMessage;
      getIdentifier: GetIdentifier;
    }
  | {
      type: "SCW";
      signMessage: SignMessage;
      getIdentifier: GetIdentifier;
      getBlockNumber?: GetBlockNumber;
      getChainId: GetChainId;
    };
```

## Identifier type (from `@xmtp/node-bindings`)

```ts
export interface Identifier {
  identifier: string;       // e.g. "0x..." lowercase Ethereum address
  identifierKind: IdentifierKind;
}

export declare const enum IdentifierKind {
  Ethereum = 0,
  Passkey = 1
}
```

**Only two values exist**: `Ethereum` (0) and `Passkey` (1). There is NO `Unspecified`, `InstallationKey`, or `Ed25519` option at the IdentifierKind level.

## What signMessage receives and returns

- Receives: `message: string` — a plain string (NOT a Uint8Array, NOT a hash)
- Returns: `Promise<Uint8Array>` — raw bytes of the secp256k1 ECDSA signature

The message string is an EIP-191 personal_sign message under the hood (viem's `wallet.signMessage` applies EIP-191 prefix before hashing). The SDK sends a text challenge; you sign it and return raw bytes.

## How server agents create signers (the real pattern)

The `@xmtp/agent-sdk` `createUser` + `createSigner` helpers show the canonical approach:
- Generate a secp256k1 private key (viem `generatePrivateKey()`)
- Derive the Ethereum address from it (`privateKeyToAccount`)
- Use `IdentifierKind.Ethereum` with the derived address as the identifier
- Sign with `wallet.signMessage`, convert hex signature to bytes with `toBytes`

**A server does NOT need a "real" Ethereum wallet** — it just needs a secp256k1 key pair. The XMTP identity is bound to the derived Ethereum address. No on-chain transaction occurs; it's just key material.

```ts
// From @xmtp/agent-sdk src/user/User.ts
import { IdentifierKind, type Signer } from "@xmtp/node-sdk";
import { createWalletClient, http, toBytes } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const key = generatePrivateKey(); // 0x... hex string, 32 bytes secp256k1
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: sepolia, transport: http() });

const signer: Signer = {
  type: "EOA",
  getIdentifier: () => ({
    identifier: account.address.toLowerCase(),
    identifierKind: IdentifierKind.Ethereum,
  }),
  signMessage: async (message: string) => {
    const sig = await wallet.signMessage({ account, message });
    return toBytes(sig);  // hex -> Uint8Array
  },
};
```

## Client.create flow (what actually happens with the signer)

From `Client.ts` source (`.reference/xmtp-js/sdks/node-sdk/src/Client.ts`):

1. `Client.create(signer, opts)` calls `signer.getIdentifier()` to get the `Identifier`.
2. Calls `client.init(identifier)` — sets up the local DB and derives `inboxId` (from `generateInboxId` or network lookup via `getInboxIdForIdentifier`).
3. Unless `disableAutoRegister: true`, calls `client.register()` which:
   - Calls `createInboxSignatureRequest()` — returns `null` if already registered, or a `SignatureRequestHandle` if new.
   - If a request exists, calls `signatureRequest.signatureText()` to get the text challenge, then calls `signer.signMessage(text)` → `Uint8Array`.
   - For EOA: calls `signatureRequest.addEcdsaSignature(signature)`.
   - Submits via `registerIdentity(signatureRequest)`.
4. After registration the signer is stored on the client but is ONLY needed again for identity management (add/remove account, revoke installations). Regular messaging uses the installation's own Ed25519 key from the local DB.

## Client.build — reconnecting without re-signing

```ts
// No signer needed — requires existing DB with same dbEncryptionKey
const client = await Client.build(identifier, { dbEncryptionKey, dbPath, env });
```

`Client.build` skips `register()` entirely. The identifier must already be registered. **Correct pattern for broker on restart** — avoids consuming a new installation slot.

## dbPath auto-derivation

From `createClient.ts`: if `dbPath` is undefined:
```
process.cwd()/xmtp-${env}-${inboxId}.db3
```
Brokers should use an explicit fixed path or the `(inboxId) => string` callback form.

## Installation limits and re-registration hazard

- An inbox can have at most **10 active installations**.
- Every `Client.create()` call against an identifier with no existing local DB creates a NEW installation and consumes one slot.
- If the local DB is lost OR the `dbEncryptionKey` changes, `Client.create()` silently creates a new installation and loses access to all prior message history.
- **Broker implication**: persist the private key, `dbEncryptionKey`, and `dbPath` together as a unit. Losing any one forces a new installation.

## Key line ranges in blz docs

- Identity model (inbox ID, identity, installation concepts): `xmtp:270-360`
- How Client.create works internally: `xmtp:7320-7430`
- Client.build pattern: `xmtp:7840-7960`
- EOA signer docs: `xmtp:7960-8100`
- Installation limits and revocation: `xmtp:10450-10620`
- agent-sdk createSigner/createUser: `xmtp:16080-16200`
- agent-sdk SCW pattern: `xmtp:16237-16260`

## Source file locations

- Signer type: `.reference/xmtp-js/sdks/node-sdk/src/utils/signer.ts`
- Client.create / register: `.reference/xmtp-js/sdks/node-sdk/src/Client.ts` lines 115-131, 504-512
- createClient (DB path logic): `.reference/xmtp-js/sdks/node-sdk/src/utils/createClient.ts`
- IdentifierKind enum: `node_modules/.bun/@xmtp+node-bindings@1.10.0/.../dist/index.d.ts`
- agent-sdk User.ts: `.reference/xmtp-js/sdks/agent-sdk/src/user/User.ts`
- node-sdk test helpers: `.reference/xmtp-js/sdks/node-sdk/test/helpers.ts`
