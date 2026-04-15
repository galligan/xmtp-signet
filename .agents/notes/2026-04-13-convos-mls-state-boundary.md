## Convos MLS State Boundary

Date: 2026-04-13
Related issues: #120, #298

## Summary

The local open-source Convos references already show the storage model we
should treat as the signet baseline:

- stable identity material is persisted and reused across restarts
- XMTP MLS state lives in a persistent local database under a chosen data dir
- conversation ownership and rebind metadata are persisted separately from the
  message database

The signet already matches that model closely enough that this is mostly a
documentation and explicit-boundary exercise, not a new architecture project.

## Evidence from the checked-in references

### `.reference/convos-node-sdk`

`src/agent/runtime.ts` persists an `agent.json` state file with the agent
private key and address, then points XMTP at a persistent
`<dataDir>/xmtp-<env>.db`.

That means the practical Convos runtime model is:

- do not mint a fresh identity on every start
- do keep the XMTP database on disk
- let runtime processes come and go while the durable identity and MLS state
  survive

### `.reference/convos-agents`

`runtime/openclaw/extensions/convos/src/credentials.ts` persists
`identityId` and `ownerConversationId`.

`runtime/openclaw/extensions/convos/src/sdk-client.ts` treats
`convos agent serve` as a long-lived process attached to a stable identity.

That reinforces the same split:

- stable identity and conversation ownership metadata are durable
- runtime process state is ephemeral

## Repo-grounded signet model

The signet already has the same three layers.

### 1. Durable identity records

`packages/core/src/identity-store.ts` persists managed identities in
`${dataDir}/identities.db`.

Each record carries:

- `identityId`
- `inboxId` once registered
- optional `groupId`
- optional human label
- creation timestamp

This is the durable source of truth for which XMTP identities the signet owns.

### 2. Durable XMTP MLS state per identity

`packages/core/src/identity-registration.ts`, `packages/core/src/convos/join.ts`,
and `packages/core/src/signet-core.ts` all point XMTP clients at the same
per-identity database shape:

```text
${dataDir}/db/${env}/${identityId}.db3
```

This is where MLS state, conversation state, and synchronized message state
live for that identity. Tests may use `:memory:` instead, but the normal model
is durable on-disk state.

### 3. Durable per-identity key material

The signet does not store raw XMTP key material in the identity store. Instead,
the signer/key manager layer provides stable per-identity keys on demand:

- `getDbEncryptionKey(identityId)`
- `getXmtpIdentityKey(identityId)`

The important boundary is that identity records, encrypted XMTP DB state, and
derived key material are separate concerns that line up by `identityId`.

## Runtime behavior

`packages/core/src/client-registry.ts` is intentionally ephemeral.

`packages/core/src/signet-core.ts` rebuilds the live client registry from the
identity store on startup by:

1. listing persisted identities
2. re-deriving the same DB encryption key and XMTP identity key
3. reopening the same per-identity XMTP database
4. syncing groups and resubscribing streams

That means restart continuity should be understood as:

- the registry is rebuilt
- the identities are reused
- the XMTP state is reused
- new runtime streams are attached to old durable state

## Practical Convos interpretation

For the current local and self-hosted v1 surface, "Convos-compatible identity"
mostly means:

- stable identity reuse across restarts
- persistent MLS/message DB state per identity
- explicit per-conversation or per-group identity ownership where the signet
  chooses to isolate chats

It does **not** currently require:

- Convos iOS passkey parity
- split host/remote ownership
- Remote-MLS or minimum-trust hosted storage

## Current conclusion

No additional core storage redesign is required to support the intended Convos
interop story in this tranche. The remaining work is to prove the story with a
tracer bullet and fix any local gaps it exposes.

## Explicit deferrals

- split host/remote design
- Remote-MLS or minimum-trust hosted storage
- Convos iOS identity or passkey parity
- broader passkey work beyond the signet-native owner-approval path
