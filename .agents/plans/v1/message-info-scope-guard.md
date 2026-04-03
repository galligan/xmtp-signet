# message.info Credential Scope Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce credential scope and `read-messages` permission on the `message.info` handler, returning `not_found` (never `permission_denied`) when a caller lacks access — preventing information leakage about message existence.

**Architecture:** Add an optional `credentialLookup` function to `MessageActionDeps`. When `ctx.credentialId` is present, the handler resolves the credential's `chatIds`, maps them through the ID mapping store, and checks `isInScope` + `read-messages` scope before returning the message. When absent (admin), validate `chatId` ↔ `groupId` coupling. Document the access model in `docs/security.md`.

**Tech Stack:** TypeScript, Zod, better-result, bun:test

**Stacks on:** `core/get-message-by-id` (PR #293, issue #284)
**Closes:** #294

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/core/src/message-actions.ts` | Modify | Add scope guard to `message.info` handler, add `credentialLookup` to deps, validate `chatId` ↔ `groupId` |
| `packages/core/src/__tests__/message-actions.test.ts` | Modify | Tests for scope enforcement, not_found on scope miss, chatId validation, admin path |
| `packages/cli/src/start.ts` | Modify | Wire `credentialLookup` into message action deps |
| `packages/cli/src/__tests__/action-surface-map.test.ts` | Modify | Update fixture if needed |
| `docs/security.md` | Modify | Document message access control behavior |

---

### Task 1: Add credentialLookup to MessageActionDeps

**Files:**
- Modify: `packages/core/src/message-actions.ts:11-18`

- [ ] **Step 1: Add the optional dep**

In `MessageActionDeps`, add an optional `credentialLookup` function. This is a narrow interface — we don't need the full `CredentialManager`, just the ability to resolve a credential ID to its record.

```typescript
import type { CredentialRecordType } from "@xmtp/signet-schemas";

export interface MessageActionDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly getManagedClient: (identityId: string) => ManagedClient | undefined;
  readonly idMappings?: IdMappingStore;
  /** Resolve a credential ID to its record. Used for scope enforcement. */
  readonly credentialLookup?: (
    credentialId: string,
  ) => Promise<Result<CredentialRecordType, SignetError>>;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: PASS — the field is optional so no call sites break.

- [ ] **Step 3: Commit**

```
feat(core): add credentialLookup to MessageActionDeps [#294]
```

---

### Task 2: Write failing tests for scope enforcement

**Files:**
- Modify: `packages/core/src/__tests__/message-actions.test.ts`

- [ ] **Step 1: Write test — credential with scope sees the message**

```typescript
describe("message.info scope enforcement", () => {
  test("returns message when credential has chat in scope", async () => {
    await seedIdentity("scoped-viewer", { messages: sampleMessages });
    // Map XMTP groupId "g1" to conv_ local ID
    idMappings.set("g1", "conv_0123456789abcdef", "conversation");

    const credentialRecord = {
      id: "cred_1234567890abcdef",
      config: {
        operatorId: "op_1234567890abcdef",
        chatIds: ["conv_0123456789abcdef"],
        allow: ["read-messages"] as const,
      },
      inboxIds: [],
      status: "active" as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      issuedBy: "owner",
    };

    deps = {
      ...deps,
      credentialLookup: async () => Result.ok(credentialRecord),
    };
    setupDeps();

    const actions = createMessageActions(deps);
    const infoAction = actions.find((a) => a.id === "message.info")!;

    const result = await infoAction.handler(
      {
        chatId: "conv_0123456789abcdef",
        messageId: "msg-aaa",
        identityLabel: "scoped-viewer",
      },
      { requestId: "test", signal: AbortSignal.timeout(5000), credentialId: "cred_1234567890abcdef" },
    );

    expect(Result.isOk(result)).toBe(true);
  });
```

- [ ] **Step 2: Write test — credential without chat in scope gets not_found**

```typescript
  test("returns not_found when credential lacks chat scope (no info leakage)", async () => {
    await seedIdentity("unscoped-viewer", { messages: sampleMessages });
    idMappings.set("g1", "conv_0123456789abcdef", "conversation");

    const credentialRecord = {
      id: "cred_1234567890abcdef",
      config: {
        operatorId: "op_1234567890abcdef",
        chatIds: ["conv_ffff456789abcdef"], // different chat
        allow: ["read-messages"] as const,
      },
      inboxIds: [],
      status: "active" as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      issuedBy: "owner",
    };

    deps = {
      ...deps,
      credentialLookup: async () => Result.ok(credentialRecord),
    };
    setupDeps();

    const actions = createMessageActions(deps);
    const infoAction = actions.find((a) => a.id === "message.info")!;

    const result = await infoAction.handler(
      {
        chatId: "conv_ffff456789abcdef",
        messageId: "msg-aaa",
        identityLabel: "unscoped-viewer",
      },
      { requestId: "test", signal: AbortSignal.timeout(5000), credentialId: "cred_1234567890abcdef" },
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.category).toBe("not_found");
    }
  });
```

- [ ] **Step 3: Write test — credential without read-messages scope gets not_found**

```typescript
  test("returns not_found when credential lacks read-messages scope", async () => {
    await seedIdentity("no-read-viewer", { messages: sampleMessages });
    idMappings.set("g1", "conv_0123456789abcdef", "conversation");

    const credentialRecord = {
      id: "cred_1234567890abcdef",
      config: {
        operatorId: "op_1234567890abcdef",
        chatIds: ["conv_0123456789abcdef"],
        allow: ["send", "reply"] as const, // no read-messages
      },
      inboxIds: [],
      status: "active" as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      issuedBy: "owner",
    };

    deps = {
      ...deps,
      credentialLookup: async () => Result.ok(credentialRecord),
    };
    setupDeps();

    const actions = createMessageActions(deps);
    const infoAction = actions.find((a) => a.id === "message.info")!;

    const result = await infoAction.handler(
      {
        chatId: "conv_0123456789abcdef",
        messageId: "msg-aaa",
        identityLabel: "no-read-viewer",
      },
      { requestId: "test", signal: AbortSignal.timeout(5000), credentialId: "cred_1234567890abcdef" },
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.category).toBe("not_found");
    }
  });
```

- [ ] **Step 4: Write test — chatId ↔ groupId mismatch returns not_found**

```typescript
  test("returns not_found when chatId does not match message groupId", async () => {
    await seedIdentity("mismatch-viewer", { messages: sampleMessages });
    idMappings.set("g1", "conv_0123456789abcdef", "conversation");
    idMappings.set("g2", "conv_ffff456789abcdef", "conversation");

    // No credentialId — admin path, but chatId doesn't match
    setupDeps();

    const actions = createMessageActions(deps);
    const infoAction = actions.find((a) => a.id === "message.info")!;

    const result = await infoAction.handler(
      {
        chatId: "conv_ffff456789abcdef", // resolves to g2
        messageId: "msg-aaa",            // lives in g1
        identityLabel: "mismatch-viewer",
      },
      stubCtx(),
    );

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) {
      expect(result.error.category).toBe("not_found");
    }
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd packages/core && bun test src/__tests__/message-actions.test.ts`
Expected: 4 new tests FAIL (scope enforcement not implemented yet)

- [ ] **Step 6: Commit**

```
test(core): add failing tests for message.info scope enforcement [#294]
```

---

### Task 3: Implement scope guard in message.info handler

**Files:**
- Modify: `packages/core/src/message-actions.ts:226-254`

- [ ] **Step 1: Add resolveEffectiveScopes helper**

Add a helper that computes effective scopes from a credential record's allow/deny config (deny wins). Place it after `resolveMessageId`.

```typescript
/**
 * Compute effective scopes from credential config allow/deny.
 * Deny always wins.
 */
function resolveEffectiveScopes(
  config: { allow?: readonly string[]; deny?: readonly string[] },
): ReadonlySet<string> {
  const allowed = new Set(config.allow ?? []);
  if (config.deny) {
    for (const scope of config.deny) {
      allowed.delete(scope);
    }
  }
  return allowed;
}
```

- [ ] **Step 2: Update message.info handler with scope guard**

Replace the handler body after managed client lookup:

```typescript
    handler: async (input, ctx) => {
      // ... identity + managed client resolution (unchanged) ...

      const xmtpMessageId = resolveMessageId(deps.idMappings, input.messageId);
      const lookupResult = managed.client.getMessageById(xmtpMessageId);
      if (Result.isError(lookupResult)) return lookupResult;

      if (!lookupResult.value) {
        return Result.err(
          NotFoundError.create("message", input.messageId) as SignetError,
        );
      }

      const message = lookupResult.value;

      // Validate chatId ↔ groupId coupling: the resolved chatId must
      // match the message's actual groupId. This prevents ID space drift
      // and ensures callers cannot fish for messages across conversations.
      const resolvedGroupId = resolveGroupId(deps.idMappings, input.chatId);
      if (message.groupId !== resolvedGroupId) {
        return Result.err(
          NotFoundError.create("message", input.messageId) as SignetError,
        );
      }

      // Credential scope enforcement: when a credentialId is present,
      // verify the credential has scope for this conversation and the
      // read-messages permission. Return not_found (not permission) to
      // prevent information leakage about message existence.
      if (ctx.credentialId && deps.credentialLookup) {
        const credResult = await deps.credentialLookup(ctx.credentialId);
        if (Result.isError(credResult)) {
          return Result.err(
            NotFoundError.create("message", input.messageId) as SignetError,
          );
        }

        const credential = credResult.value;
        const credChatIds = credential.config.chatIds;

        // Resolve credential's conv_ chatIds to XMTP groupIds for comparison
        const resolvedCredGroupIds = credChatIds.map((chatId) =>
          resolveGroupId(deps.idMappings, chatId),
        );

        if (!resolvedCredGroupIds.includes(message.groupId)) {
          return Result.err(
            NotFoundError.create("message", input.messageId) as SignetError,
          );
        }

        const effectiveScopes = resolveEffectiveScopes(credential.config);
        if (!effectiveScopes.has("read-messages")) {
          return Result.err(
            NotFoundError.create("message", input.messageId) as SignetError,
          );
        }
      }

      return Result.ok(message);
    },
```

Note: the handler signature changes from `async (input)` to `async (input, ctx)` to access `ctx.credentialId`.

- [ ] **Step 3: Run tests**

Run: `cd packages/core && bun test src/__tests__/message-actions.test.ts`
Expected: All tests PASS including the 4 new scope enforcement tests.

- [ ] **Step 4: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(core): enforce credential scope and chatId coupling on message.info [#294]
```

---

### Task 4: Wire credentialLookup in the daemon

**Files:**
- Modify: `packages/cli/src/start.ts:825-846`

- [ ] **Step 1: Add credentialLookup to the createMessageActions call**

```typescript
    createMessageActions() {
      // ... existing code ...
      return createMessageActions({
        identityStore: coreImplRef.identityStore,
        getManagedClient: (id) => coreImplRef!.getManagedClient(id),
        idMappings: idMappingStoreRef,
        credentialLookup: credentialManagerRef
          ? (credentialId) => credentialManagerRef!.lookup(credentialId)
          : undefined,
      });
    },
```

- [ ] **Step 2: Run full check**

Run: `bun run check`
Expected: PASS

- [ ] **Step 3: Commit**

```
feat(cli): wire credentialLookup into message action deps [#294]
```

---

### Task 5: Document message access control in security docs

**Files:**
- Modify: `docs/security.md`

- [ ] **Step 1: Add message access control section**

Add a new section to `docs/security.md` documenting the message access control
behavior, the not_found-over-permission pattern, the chatId ↔ groupId coupling
requirement, and the biometric gate invariant as it applies to message reads.

- [ ] **Step 2: Run docs check**

Run: `bun run docs:check`
Expected: PASS

- [ ] **Step 3: Commit**

```
docs: document message access control and scope enforcement [#294]
```
