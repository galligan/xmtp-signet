# CLAUDE.md -- xmtp-signet

An agent signet for XMTP. The signet is the real XMTP client; harnesses
connect through a controlled interface with scoped credentials, permission
policies, and public seals. See [README.md](README.md) for the overview and
[.agents/docs/init/xmtp-signet.md](.agents/docs/init/xmtp-signet.md) for the
PRD.

> [!NOTE]
> The current local stack is on the v1 runtime model, with public interfaces
> expressed directly in terms of credentials, policies, and seals.

## Status

Active development. The local PR stack is feature-complete for the v1
operator/policy/credential/seal model and pending merge to `main`.

Current center of gravity:

- identity model: `owner -> admin -> operator -> credential -> seal`
- permission system: allow/deny scope sets with deny-wins resolution
- key runtime: local encrypted vault, admin auth, operational rotation,
  OWS-inspired direction
- CLI: `xs` with direct v1 command groups such as `credential`

## Project structure

- `packages/` — libraries, source in `src/`, tests in `src/__tests__/`
- `signet-signer/` — Swift CLI for Secure Enclave key operations
- `.agents/docs/` — PRD and long-form docs
- `.agents/plans/` — v1 plans, execution docs, design decisions
- `.agents/notes/` — working notes and research
- `.claude/` — local skills, agent configs, memory
- `.trail/` — handoff notes and working logs
- `docs/` — public architecture, concepts, and development guides

## Commands

```bash
# Bootstrap
bun run bootstrap

# Build / verify
bun run build
bun run test
bun run typecheck
bun run lint
bun run docs:check
bun run check

# Single package
cd packages/<pkg> && bun test

# CLI
xs --help
xs start
xs status --json
xs credential issue --operator op_a7f3 --credential @credential.json
xs credential inspect cred_b2c1

# XMTP docs lookup
blz query -s xmtp "your query" --limit 5 --text

# Repo-local docs lookup
qmd query "your query" -c xmtp-signet
qmd query "your query" -c xmtp-signet-plans
qmd query "your query" -c xmtp-signet-claude
```

For local documentation search, always prefer `qmd`. After changing docs or
skills, refresh the index:

```bash
qmd update
qmd embed
```

## Development principles

### Non-negotiable

- **TDD first**: red, green, refactor
- **Result types**: operational failures return `Result<T, E>`
- **Schema first**: Zod schemas define runtime validation and TS types
- **No raw credentials in the harness**: the harness never gets raw keys, raw
  DB access, or direct XMTP SDK access

### Strong preferences

- Bun-native APIs before new dependencies
- Small files and focused modules
- Transport-agnostic handlers
- Validate inputs at boundaries, trust typed values internally

## Architecture

### Handler contract

All domain logic uses transport-agnostic handlers:

```typescript
type Handler<TInput, TOutput, TError extends SignetError> = (
  input: TInput,
  ctx: HandlerContext,
) => Promise<Result<TOutput, TError>>;
```

`HandlerContext` includes:

- `requestId`
- `signal`
- optional `adminAuth`
- optional `operatorId`
- optional `credentialId`

Handlers receive pre-validated input, return `Result`, and never throw for
normal operational failures.

### Package tiers

**Foundation**

- schemas: resource IDs, policies, credentials, seals, requests, events,
  errors
- contracts: service interfaces, handler contract, action registry

**Runtime**

- core: XMTP lifecycle and streams
- keys: vault, admin auth, operational keys
- sessions: credential lifecycle, reveal state, pending actions
- seals: seal issuance and chain management
- policy: scope resolution, projection, materiality
- verifier: trust checks

**Transport**

- ws: primary harness-facing transport
- mcp: scoped MCP tool surface
- cli: `xs` binary, daemon lifecycle, admin socket, HTTP admin API

### Identity model

```text
Owner -> Admin -> Operator -> Credential -> Seal
```

- **Owner**: bootstraps and anchors trust
- **Admin**: manages operators and credentials
- **Operator**: purpose-built agent profile
- **Credential**: time-bound, chat-scoped authorization
- **Seal**: public declaration of active scope and permissions

### Permission model

Permission scopes are grouped into these categories:

- `messaging`
- `group-management`
- `metadata`
- `access`
- `observation`
- `egress`

Policies provide reusable allow/deny bundles. Credentials can override them
inline. Deny always wins.

### Resource IDs

Canonical local resource IDs use a prefix plus 16 lowercase hex characters:

- `op_<16hex>`
- `conv_<16hex>`
- `policy_<16hex>`
- `cred_<16hex>`
- `seal_<16hex>`
- `msg_<16hex>`
- `xmtp_<16hex>`

Short IDs are accepted where they resolve uniquely.

### CLI surface

The current `xs` command groups are:

- `start`, `stop`, `status`
- `identity`
- `credential`
- `seal`
- `message`
- `conversation`
- `admin`
- `keys`

`xs credential ...` is the canonical lifecycle surface for issuing, inspecting,
listing, and revoking v1 credentials.

## Error taxonomy

Use the shared error categories from `@xmtp/signet-schemas`:

- `validation`
- `not_found`
- `permission`
- `auth`
- `internal`
- `timeout`
- `cancelled`

In v1 terms, `auth` generally means invalid or expired admin tokens or
credentials.

## Reference material

The `.reference/` directory is read-only context. Do not edit it.

- `.reference/keypo-cli/` — secure key custody patterns
- `.reference/xmtp-js/` — official XMTP SDKs and CLI
- `.reference/convos-node-sdk/` — conversation-scoped identity patterns
- `.reference/convos-cli/` — CLI patterns around XMTP agent workflows
- `.reference/convos-agents/` — orchestration and runtime patterns

## Research notes

Working notes from repository analysis live in `.agents/notes/`. Treat them as
scratch context rather than canonical docs.
