# Signet Contract Cutover Implementation Plan

Date: 2026-03-30
Status: Local implementation note

## Purpose

This note turns the design direction in
`/Users/mg/Developer/xmtp/xmtp-signet/.scratch/signet-trails-alignment.md`
into an implementation-oriented cutover plan.

This is intentionally local-only:

- it uses local absolute paths
- it leans on the local Trails checkout for concrete source material
- it is optimized for doing the work here, not for public documentation

## Cutover stance

Treat this as a true cutover.

Assumptions:

- nobody external depends on the current `ActionSpec` surface
- no backward-compatibility shim is required
- we should spend our freedom on a cleaner authored model, not on migration scaffolding

That means the order is:

1. replace the thin contract model
2. move all transports onto it
3. validate and snapshot the surface
4. then expose HTTP and outbound bridge work on top of that model

## The Trails source material we should copy from

These files are the most relevant local sources:

- `/Users/mg/Developer/outfitter/trails/packages/core/src/trail.ts`
- `/Users/mg/Developer/outfitter/trails/packages/http/src/build.ts`
- `/Users/mg/Developer/outfitter/trails/packages/mcp/src/annotations.ts`
- `/Users/mg/Developer/outfitter/trails/packages/core/src/validate-topo.ts`
- `/Users/mg/Developer/outfitter/trails/packages/testing/src/examples.ts`
- `/Users/mg/Developer/outfitter/trails/packages/testing/src/contracts.ts`
- `/Users/mg/Developer/outfitter/trails/packages/schema/src/generate.ts`
- `/Users/mg/Developer/outfitter/trails/packages/schema/src/hash.ts`

Why these matter:

- `trail.ts` shows the authored contract shape that survived cleanup
- `build.ts` shows deterministic HTTP derivation and collision handling
- `annotations.ts` shows how safety moved out of per-surface authored booleans
- `validate-topo.ts` shows centralized structural validation
- `examples.ts` and `contracts.ts` show executable contract testing
- `generate.ts` and `hash.ts` show surface drift detection

## Current Signet seams

These are the main local touch points for the cutover:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-spec.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-registry.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/index.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/admin/dispatcher.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/http/server.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/runtime.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/tool-registration.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/call-handler.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/core/src/conversation-actions.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/sessions/src/reveal-actions.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/actions/signet-actions.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/__tests__/action-registry.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/__tests__/admin-dispatcher.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/__tests__/tool-registration.test.ts`

## Target authored model

This is the proposed target shape for the cutover.

```ts
export type ActionIntent = "read" | "write" | "destroy";

export interface ActionExample<I, O> {
  readonly name: string;
  readonly description?: string;
  readonly input: Partial<I>;
  readonly expected?: O;
  readonly error?: string;
}

export interface HttpSurface {
  readonly path?: string;
  readonly method?: "GET" | "POST" | "DELETE";
  readonly auth: "admin" | "credential";
  readonly expose?: boolean;
}

export interface CliSurface {
  readonly command?: string;
  readonly aliases?: readonly string[];
  readonly options?: readonly CliOption[];
  readonly outputFormat?: "table" | "json" | "text";
  readonly group?: string;
}

export interface McpSurface {
  readonly toolName?: string;
  readonly annotations?: Record<string, unknown>;
}

export interface ActionSpec<TInput, TOutput, TError extends SignetError = SignetError> {
  readonly id: string;
  readonly input: z.ZodType<TInput>;
  readonly output?: z.ZodType<TOutput>;
  readonly handler: Handler<TInput, TOutput, TError>;
  readonly description?: string;
  readonly examples?: readonly ActionExample<TInput, TOutput>[];
  readonly intent?: ActionIntent;
  readonly idempotent?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly cli?: CliSurface;
  readonly mcp?: McpSurface;
  readonly http?: HttpSurface;
}
```

Notes:

- `intent` defaults to `"write"` in derivation helpers, not by every caller
- `idempotent` remains orthogonal to `intent`, following Trails
- `http.auth` is Signet-specific and should stay authored
- `http.expose` gives us a clear curation flag for the HTTP surface
- top-level `description` is the source for CLI/MCP/HTTP defaults

## Explicit derivation rules

These should live in pure helpers under `packages/contracts/src/` or a nearby `derive/` folder.

### HTTP

- method:
  - `read` -> `GET`
  - `write` -> `POST`
  - `destroy` -> `DELETE`
- path:
  - `credential.list` -> `/v1/actions/credential/list` or `/v1/agent/actions/credential/list`
- input source:
  - `GET` -> query
  - `POST` / `DELETE` -> body

### CLI

- command:
  - `credential.list` -> `credential:list`
- rpc method:
  - derive from `id`
  - stop storing it as authored state
- description:
  - derive from top-level `description`

### MCP

- tool name:
  - `credential.list` -> `signet/credential/list`
- `readOnlyHint`:
  - derive from `intent === "read"`
- `destructiveHint`:
  - derive from `intent === "destroy"`
- `idempotentHint`:
  - derive from `idempotent === true`
- title/description:
  - derive from top-level `description`

## What should remain authored

These should stay explicitly controlled in Signet:

- `http.auth`
- `http.expose`
- CLI option wiring
- CLI aliases / output formatting
- MCP extra annotations beyond the standard derived hints
- explicit surface overrides for exceptional paths or names

This is where Signet should adapt Trails, not mirror it blindly.

## What should disappear

The cutover should intentionally remove or de-emphasize these current patterns:

- authored `cli.rpcMethod`
- authored `mcp.readOnly`
- authored `mcp.destructive`
- duplicate `description` strings across surfaces
- hardcoded surface discovery limited to `"cli" | "mcp"`
- hand-wired HTTP action routes living forever in
  `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/http/server.ts`

## File-by-file implementation plan

### 1. Contracts package

Primary files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-spec.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-registry.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/index.ts`

Work:

- replace the thin `ActionSpec` surface types with the cutover shape
- add `ActionIntent`, `ActionExample`, and `HttpSurface`
- add derivation helpers:
  - `deriveCliCommand()`
  - `deriveRpcMethod()`
  - `deriveMcpToolName()`
  - `deriveMcpAnnotations()`
  - `deriveHttpMethod()`
  - `deriveHttpPath()`
  - `deriveHttpInputSource()`
- add registry validation:
  - duplicate action IDs
  - derived HTTP route collisions
  - missing `http.auth` for exposed HTTP actions
  - contradictory authored/derived overrides
- generalize `listForSurface()` beyond the literal union `"cli" | "mcp"`

Suggested new files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-derive.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-validate.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/action-example.ts`

### 2. CLI admin dispatcher

Primary file:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/admin/dispatcher.ts`

Work:

- stop treating `cli.rpcMethod` as primary authored state
- derive RPC method from `id` or from the standardized CLI derivation helper
- keep this module focused on dispatch, not derivation logic

### 3. HTTP server

Primary file:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/http/server.ts`

Work:

- keep existing health/admin/credential routes
- add a route builder for credential/admin action surfaces driven from `ActionSpec.http`
- stop hand-authoring action endpoints one by one
- route auth based on `http.auth`
- parse input from query/body based on derived HTTP method
- use registry validation to fail fast on collisions

Likely outcome:

- keep the server as the Bun/Response adapter
- move the action-route building logic into a separate helper, similar in spirit to Trails `buildHttpRoutes()`

Suggested new file:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/http/action-routes.ts`

### 4. MCP transport

Primary files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/tool-registration.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/call-handler.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/server.ts`

Work:

- simplify tool registration so it derives standard annotations from top-level semantics
- keep `mcp.annotations` only as an override/extension mechanism
- stop relying on authored `mcp.readOnly` / `mcp.destructive`
- use generalized surface discovery from the registry

### 5. Runtime registration

Primary file:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/runtime.ts`

Work:

- register actions as before
- add a central validation call after action registration and before transport startup
- fail runtime creation if contract validation fails

This should mirror the spirit of Trails validating the topology before surfacing it.

### 6. Existing action specs

Representative files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/actions/signet-actions.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/sessions/src/reveal-actions.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/core/src/conversation-actions.ts`

Work:

- move descriptions to top-level `description`
- replace `mcp.readOnly` / `mcp.destructive` with `intent`
- add `idempotent` where it matters
- add `http` exposure/auth policy where appropriate
- strip duplicated surface metadata that becomes derived

### 7. Tests

Primary files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/__tests__/action-registry.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/__tests__/admin-dispatcher.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/mcp/src/__tests__/tool-registration.test.ts`

New likely test files:

- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/__tests__/action-derive.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/contracts/src/__tests__/action-validate.test.ts`
- `/Users/mg/Developer/xmtp/xmtp-signet/packages/cli/src/http/__tests__/action-routes.test.ts`

Work:

- update registry tests for generalized surface discovery
- add derivation tests for CLI/MCP/HTTP defaults
- add validation tests for route collisions and missing auth
- add contract/example tests for exported actions

## Recommended execution phases

### Phase A. Contract core cutover

Deliverables:

- new `ActionSpec` shape
- derivation helpers
- registry validation
- updated exports

Exit criteria:

- contracts package builds and tests pass

### Phase B. Transport convergence

Deliverables:

- CLI derives RPC/command defaults
- MCP derives annotations and names from shared semantics
- HTTP route builder exists and is action-registry driven

Exit criteria:

- all three surfaces consume the same authored model

### Phase C. Action spec migration

Deliverables:

- existing actions updated to the new shape
- duplicated metadata removed
- auth/exposure decisions encoded for HTTP

Exit criteria:

- no remaining authored `mcp.readOnly` / `mcp.destructive`
- no remaining authored `cli.rpcMethod`

### Phase D. Contract trust and drift controls

Deliverables:

- example-backed action tests
- minimal surface map or lock file generation

Exit criteria:

- public surface changes are reviewable and detectable

## Suggested issue breakdown

These are good first-pass GitHub/Linear issue shapes.

### Issue 1. Cut over `ActionSpec` to the stronger authored model

Scope:

- `packages/contracts/src/action-spec.ts`
- `packages/contracts/src/index.ts`

Acceptance criteria:

- top-level `intent`, `idempotent`, `description`, `metadata`, `examples`
- `http` surface type added
- current surface-specific safety booleans removed or deprecated immediately

### Issue 2. Add deterministic derivation helpers and registry validation

Scope:

- `packages/contracts/src/action-derive.ts`
- `packages/contracts/src/action-validate.ts`
- `packages/contracts/src/action-registry.ts`

Acceptance criteria:

- CLI/MCP/HTTP defaults derive from the contract
- route collisions are detected
- registry validation runs centrally

### Issue 3. Move CLI and MCP onto the derived model

Scope:

- `packages/cli/src/admin/dispatcher.ts`
- `packages/mcp/src/tool-registration.ts`
- `packages/mcp/src/call-handler.ts`
- `packages/mcp/src/server.ts`

Acceptance criteria:

- no authored `cli.rpcMethod`
- no authored `mcp.readOnly` / `mcp.destructive`
- transport behavior matches derived semantics

### Issue 4. Build the contract-driven HTTP action surface

Scope:

- `packages/cli/src/http/server.ts`
- new HTTP route builder/helper

Acceptance criteria:

- action exposure comes from the registry
- auth comes from `http.auth`
- methods and paths derive by default
- existing admin/health routes continue to work

### Issue 5. Migrate exported action specs

Scope:

- all existing action-defining files under `packages/`

Acceptance criteria:

- top-level descriptions and intents added
- duplicated surface metadata removed
- HTTP exposure/auth curated explicitly

### Issue 6. Add contract/example tests and surface drift detection

Scope:

- new tests in `packages/contracts` and `packages/cli`
- minimal surface-map generation

Acceptance criteria:

- representative actions have executable examples
- output-schema drift is caught in tests
- surface artifact/hash exists for review and CI use

## Open questions

These are worth answering before implementation starts:

1. What should the default HTTP base path be?
   Candidate:
   - `/v1/agent/actions/...`
   - `/v1/actions/...`

2. Should admin-only actions and credential-scoped actions share one HTTP derivation helper with different auth/exposure policies, or should they build separate route sets from the same contract model?

3. How much of the Trails example model do we want in the first cutover?
   My recommendation:
   - add the `examples` field now
   - require example-backed tests only for actions intended for public surfaces

4. Do we want a full surface-map artifact immediately, or a smaller lock/hash first?
   My recommendation:
   - start with a lightweight hashable action surface snapshot
   - grow toward a richer map only if it proves useful

## Recommendation

If we start implementation right away, the first coding move should be:

1. cut over `packages/contracts/src/action-spec.ts`
2. add derivation + validation helpers in `packages/contracts`
3. update the MCP adapter to prove the derived model simplifies real code
4. then build the HTTP action route builder on top of the same helpers

That sequence gives us early confirmation that the cutover is genuinely improving the code, not just changing its shape.
