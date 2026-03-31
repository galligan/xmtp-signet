# Selective Trails Alignment for `xmtp-signet`

Date: 2026-03-30
Status: Working memo

## Thesis

Yes: Signet should move closer to the newer Trails contract model.

No: Signet should not take a runtime dependency on Trails.

The right move is to back-port the contract discipline that Trails has grown into, while keeping Signet's security boundary and runtime model fully native to this repo.

That gives us three wins at once:

- a cleaner path to the harness-facing HTTP action surface
- a better foundation for the outbound event bridge work
- less long-term drift between the authored contract and the exposed surfaces

Because nobody is using this yet, we should treat that as permission for a real cutover.

That means:

- no compatibility shim layer unless it genuinely reduces implementation risk
- no long-lived `ActionSpec v1` and `ActionSpec v2` coexistence
- no need to preserve thin, surface-specific metadata shapes just because they shipped locally once

This is the rare moment where we can still improve the authored model before it ossifies.

## Why this is worth doing

The current Signet design already has the hard middle layer:

- transport-agnostic handlers
- Zod input contracts
- registry-backed action discovery
- a shared dispatcher that does lookup, validation, execution, and error normalization

That shows up directly in:

- `packages/contracts/src/action-spec.ts`
- `packages/contracts/src/action-registry.ts`
- `packages/cli/src/admin/dispatcher.ts`

The gap is that the contract is still relatively thin and surface-specific.

Today:

- `ActionSpec` has `cli` and `mcp` metadata, but no first-class `intent`, no `http`, and no generalized derivation model
- `ActionRegistry.listForSurface()` only knows about `"cli"` and `"mcp"`
- the HTTP server in `packages/cli/src/http/server.ts` is still a narrow hand-wired surface for admin and credential routes

That is fine for where the repo started. It is less fine if we want HTTP and outbound bridge work to feel deliberate rather than bolted on.

## What Trails figured out that matters here

The important Trails improvements are not "more framework." They are stronger authored contracts and better guardrails around how surfaces are derived.

The highest-value pieces are:

1. `intent` is first-class.
   A contract says whether an action is `read`, `write`, or `destroy`, instead of making each surface infer safety on its own.

2. `idempotent` is explicit.
   Retry semantics stop being a transport guess.

3. Surface derivation is deterministic.
   The contract is the source of truth, and CLI/MCP/HTTP defaults are derived from it the same way every time.

4. Structural validation exists.
   Duplicate registrations, route collisions, invalid references, and contradictory metadata are caught before runtime behavior gets weird.

5. Contract testing is example-backed.
   The contract does not only type-check; it proves itself against examples and output-schema verification.

6. Surface drift becomes visible.
   A generated surface artifact or lock file makes it obvious when a code change silently changes a public surface.

Those are exactly the kinds of optimizations that help Signet right now.

## Concrete Trails patterns worth copying

The case for alignment is stronger when we look at the actual code.

### 1. The authored contract got richer, not more magical

From `trails/packages/core/src/trail.ts`:

```ts
export interface TrailSpec<I, O> {
  readonly input: z.ZodType<I>;
  readonly output?: z.ZodType<O> | undefined;
  readonly run: Implementation<I, O>;
  readonly description?: string | undefined;
  readonly examples?: readonly TrailExample<I, O>[] | undefined;
  readonly intent?: 'read' | 'write' | 'destroy' | undefined;
  readonly idempotent?: boolean | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly detours?: Readonly<Record<string, readonly string[]>> | undefined;
  readonly fields?: Readonly<Record<string, FieldOverride>> | undefined;
  readonly follow?: readonly string[] | undefined;
}
```

Why it works:

- the contract declares semantics once, at author time
- surfaces do not have to infer safety from ad hoc booleans or per-surface config
- examples and metadata become part of the authored model, not side-channel documentation

In Signet terms, this is the strongest argument for expanding `ActionSpec` rather than just bolting on an `http` property.

### 2. HTTP derivation is explicit and boring in the right way

From `trails/packages/http/src/build.ts`:

```ts
const intentToMethod: Record<string, HttpMethod> = {
  destroy: 'DELETE',
  read: 'GET',
  write: 'POST',
};

const deriveMethod = (trail: Trail<unknown, unknown>): HttpMethod =>
  intentToMethod[trail.intent] ?? 'POST';

const derivePath = (basePath: string, trailId: string): string => {
  const segments = trailId.replaceAll('.', '/');
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${segments}`;
};

const deriveInputSource = (method: HttpMethod): InputSource =>
  method === 'GET' ? 'query' : 'body';
```

Why it works:

- it is pure and deterministic
- a human can predict the public surface by reading the contract
- the default is strong enough that overrides stay exceptional

This is especially relevant for Signet because our current docs already describe HTTP as part of the action-registry story, but the implementation is still hand-wired.

### 3. Route collisions are detected before runtime confusion

Also from `trails/packages/http/src/build.ts`:

```ts
const registerRoute = (
  route: HttpRouteDefinition,
  seenRoutes: Map<string, string>,
  routes: HttpRouteDefinition[]
): Result<void, Error> => {
  const key = `${route.method} ${route.path}`;
  const existingId = seenRoutes.get(key);
  if (existingId !== undefined) {
    return Result.err(
      new ValidationError(
        `HTTP route collision: trails "${existingId}" and "${route.trailId}" both derive ${route.method} ${route.path}`
      )
    );
  }
  seenRoutes.set(key, route.trailId);
  routes.push(route);
  return Result.ok();
};
```

Why it works:

- the system fails at build/registration time, not after two surfaces are already fighting over the same route
- deterministic derivation stays safe because collisions are part of the model, not a surprise

For Signet, this is exactly the sort of validation we should add before publishing a credential-scoped HTTP surface.

### 4. MCP hints come from the same semantic contract

From `trails/packages/mcp/src/annotations.ts`:

```ts
const intentToHint: Partial<Record<Intent, string>> = {
  destroy: 'destructiveHint',
  read: 'readOnlyHint',
};

export const deriveAnnotations = (
  trail: Pick<Trail<unknown, unknown>, 'intent' | 'idempotent' | 'description'>
): McpAnnotations => {
  const annotations: Record<string, unknown> = {};

  const hint = intentToHint[trail.intent];
  if (hint) {
    annotations[hint] = true;
  }
  if (trail.idempotent === true) {
    annotations['idempotentHint'] = true;
  }
  if (trail.description !== undefined) {
    annotations['title'] = trail.description;
  }

  return annotations as McpAnnotations;
};
```

Why it works:

- safety semantics do not have to be re-authored for each transport
- MCP becomes a projection of the contract, not a sibling contract

This maps cleanly onto Signet, where `mcp.readOnly` and `mcp.destructive` are currently authored directly instead of being derived from a shared semantic source.

That is exactly the sort of battle-tested cleanup we should copy. Trails already proved that safety booleans scattered across surfaces are the wrong center of gravity; `intent` is the better authored primitive.

### 5. Structural validation became a first-class step

From `trails/packages/core/src/validate-topo.ts`:

```ts
export const validateTopo = (topo: Topo): Result<void, ValidationError> => {
  const issues = [
    ...checkFollows(topo.trails, topo),
    ...checkExamples(topo.trails),
    ...checkEventOrigins(topo.events, topo),
  ];

  if (issues.length === 0) {
    return Result.ok();
  }

  return Result.err(
    new ValidationError(
      `Topo validation failed with ${issues.length} issue(s)`,
      {
        context: { issues },
      }
    )
  );
};
```

Why it works:

- validation is centralized instead of being scattered across adapters
- all discovered issues come back together, which makes fixup much faster
- the system checks authored structure, not just runtime execution

Signet does not need the full topo model to benefit from this pattern. A registry-level validator would already buy us a lot.

### 6. Examples became executable contracts

From `trails/packages/testing/src/examples.ts` and `contracts.ts`:

```ts
const result = await t.run(validatedInput, testCtx);
assertProgressiveMatch(result, example, output);
```

```ts
const parsed = outputSchema.safeParse(value);
if (!parsed.success) {
  throw new Error(
    `Output schema violation for trail "${trailId}", example "${exampleName}" ...`
  );
}
```

Why it works:

- examples stop being inert documentation
- output schemas stop drifting quietly away from implementation behavior
- the authored contract becomes easier to trust

This is a strong fit for Signet actions that we expect to expose publicly through CLI, MCP, or HTTP.

### 7. Surface drift became measurable

From `trails/packages/schema/src/generate.ts` and `hash.ts`:

```ts
export const generateSurfaceMap = (topo: Topo): SurfaceMap => {
  const entries: SurfaceMapEntry[] = [];
  for (const t of topo.trails.values()) {
    entries.push(trailToEntry(t as Trail<unknown, unknown>));
  }
  const sorted = entries.toSorted((a, b) => a.id.localeCompare(b.id));
  return {
    entries: sorted,
    generatedAt: new Date().toISOString(),
    version: '1.0',
  };
};
```

```ts
export const hashSurfaceMap = (surfaceMap: SurfaceMap): string => {
  const { generatedAt: _unused, ...rest } = surfaceMap;
  const canonical = canonicalize(rest);
  const json = JSON.stringify(canonical);
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(json);
  return hasher.digest('hex');
};
```

Why it works:

- public-surface changes become reviewable artifacts
- drift detection stops depending on human memory
- the framework can tell when a contract change is materially breaking

This is probably overkill for Signet today if done in full. It is not overkill to add a lighter-weight surface map before the HTTP surface is treated as stable.

## Side-by-side cutover sketch

This is the most important practical question: what should actually change in Signet's contract model?

### Current Signet shape

Today, the authored contract is intentionally small:

```ts
export interface ActionSpec<TInput, TOutput, TError extends SignetError = SignetError> {
  readonly id: string;
  readonly handler: Handler<TInput, TOutput, TError>;
  readonly input: z.ZodType<TInput>;
  readonly output?: z.ZodType<TOutput>;
  readonly cli?: CliSurface;
  readonly mcp?: McpSurface;
}
```

That got us the good part early:

- one handler
- one input schema
- multiple surfaces

But it also leaves the important semantics either unexpressed or duplicated:

- no shared safety model
- no HTTP shape
- no examples
- no metadata for filtering/governance
- surface-specific duplication of descriptions and safety hints

### Proposed Signet cutover shape

The best next shape is heavily informed by Trails, but adapted to Signet's auth model:

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

The key point is that this is not just "add an `http` field."

It is:

- keep the current handler and schema discipline
- add the semantic fields that Trails proved were worth promoting
- keep Signet-specific auth and exposure decisions local to Signet

### What should be derived instead of authored

This is where we should lean hardest on the Trails cleanup work.

Fields that should stop being authored directly:

- `mcp.readOnly`
- `mcp.destructive`
- duplicate per-surface descriptions
- `http.inputSource`
- most default HTTP methods
- most default CLI commands
- most default MCP tool names

Those should derive from:

- `id`
- `description`
- `intent`
- `idempotent`

This is exactly the kind of cruft Trails burned down over time.

It also maps directly onto current Signet code: `packages/mcp/src/tool-registration.ts` still turns authored `mcp.readOnly` / `mcp.destructive` fields straight into MCP hints. That is the old duplication we should remove instead of carrying forward into HTTP.

### What should remain surface-specific

We should not copy Trails so literally that we erase Signet's security model.

Fields that should remain explicit and Signet-native:

- HTTP auth surface: `admin` vs `credential`
- whether a surface is exposed at all
- CLI options and formatting choices
- MCP extra annotations beyond the standard derived hints
- any truly exceptional route or tool-name override

This is the part where Signet should adapt Trails, not mimic it blindly.

## Field-by-field cutover

### Keep as-is

- `id`
- `input`
- `output`
- `handler`
- `cli.options`
- `cli.aliases`
- `cli.outputFormat`
- `mcp.annotations` as an escape hatch

### Keep, but move up to top-level semantics

- descriptions should primarily live at `ActionSpec.description`
- safety semantics should primarily live at `ActionSpec.intent`
- retry semantics should primarily live at `ActionSpec.idempotent`

### Convert to derived defaults

- `cli.command`
  Default from `id`, e.g. `credential.list` -> `credential:list`

- `cli.rpcMethod`
  Remove it as authored state and derive from `id`

- `mcp.toolName`
  Default from `id`, e.g. `credential.list` -> `signet/credential/list`

- `mcp.description`
  Default from top-level `description`

- `mcp.readOnly`
  Derive from `intent === "read"`

- `mcp.destructive`
  Derive from `intent === "destroy"`

- `http.method`
  Default from `intent`

- `http.path`
  Default from `id`

- `http.inputSource`
  Derive from HTTP method; do not store it

### Add new authored state

- `intent`
- `idempotent`
- `examples`
- `metadata`
- `http.auth`
- `http.expose`

### Remove entirely

- any long-term need to hardcode surface discovery as `"cli" | "mcp"`
- any expectation that HTTP routes will be maintained by one-off handler wiring in `packages/cli/src/http/server.ts`

## Transport consequences after cutover

### CLI

The CLI should become closer to a projection:

- command name defaults from `id`
- description defaults from top-level `description`
- dangerous behavior can key off `intent`
- only options/formatting stay surface-authored

This is cleaner than today's split between `id`, `command`, and `rpcMethod`.

### MCP

The MCP adapter should get noticeably simpler.

Today it reads explicit `mcp.readOnly` and `mcp.destructive` fields and packages them directly. After cutover, it should mostly:

- convert `input` to JSON Schema
- derive standard safety hints from `intent` and `idempotent`
- inherit `description`
- honor `toolName` override only when needed

That is much closer to the Trails model, and Trails has already proven that this removes duplicated authored state.

### HTTP

HTTP is where the cutover pays off the most.

Instead of:

- hand-authored routes in the server
- hand-decided methods
- a parallel public-surface story

we should get:

- method derived from `intent`
- path derived from `id`
- auth decided by Signet's own `http.auth`
- route collision detection during registration/build
- one mechanical adapter over the same contract model as CLI and MCP

That is the main architectural reward for doing the cutover now.

## Representative before/after example

### Current style

```ts
const spec: ActionSpec<Input, Output, SignetError> = {
  id: "credential.list",
  input: CredentialListInput,
  output: CredentialListOutput,
  handler: listCredentials,
  cli: {
    command: "credential:list",
    rpcMethod: "credential.list",
    description: "List credentials",
  },
  mcp: {
    toolName: "signet/credential/list",
    description: "List credentials",
    readOnly: true,
  },
};
```

### Proposed style

```ts
const spec: ActionSpec<Input, Output, SignetError> = {
  id: "credential.list",
  input: CredentialListInput,
  output: CredentialListOutput,
  handler: listCredentials,
  description: "List credentials",
  intent: "read",
  idempotent: true,
  cli: {},
  mcp: {},
  http: {
    auth: "admin",
    expose: true,
  },
};
```

What disappears:

- repeated description text
- hand-authored `rpcMethod`
- hand-authored MCP safety booleans
- the need to hand-decide a default HTTP method

What stays explicit:

- the action's meaning
- the auth boundary
- any genuine transport override

## What Signet should adopt

### 1. Expand `ActionSpec` into a richer authored contract

Keep the current shape, but promote a few ideas into first-class fields:

- `intent: "read" | "write" | "destroy"`
- `idempotent?: boolean`
- `description?: string`
- `examples?: ...`
- `metadata?: Record<string, unknown>`

This does two things:

- it gives HTTP and MCP a shared semantic source of truth
- it makes contract testing and surface generation possible without each surface inventing its own rules

This is the single most important alignment step.

### 2. Add a real `http` surface, but keep derivation as the default

Signet should support explicit HTTP overrides, but they should be overrides, not the primary authored shape.

Good model:

- authored contract says what the action is
- derivation decides the default HTTP method/path/input source
- `http` metadata exists for curated overrides where needed

That means we avoid building a world where every action has to hand-author its HTTP route forever.

### 3. Generalize registry discovery beyond `cli | mcp`

`ActionRegistry` should stop being hardcoded around the surfaces we happened to ship first.

It should support:

- listing all surfaced actions
- asking for a surface by key
- validating registrations once, centrally

This will matter immediately for HTTP and later for any bridge-specific action exposure.

### 4. Add a registry validation pass

Before public HTTP exists, we should validate:

- duplicate action IDs
- duplicate derived HTTP routes
- contradictory safety metadata
- missing required surface descriptions
- collisions between explicit overrides and derived defaults

This is cheap insurance while the public surface is still malleable.

### 5. Add example-backed contract checks for exported actions

Not every internal action needs a rich example suite immediately. The exported surfaces do.

For the actions we expect to expose through HTTP, CLI, or MCP, we should be able to say:

- this example input parses
- this handler returns an output that matches the declared schema
- the derived/public surface is stable

That closes the gap between "typed" and "trustworthy."

### 6. Add a surface map or lock file before publishing HTTP broadly

Before HTTP becomes a relied-on public interface, we should have a generated artifact that captures:

- action IDs
- derived CLI/MCP/HTTP projections
- input/output contract fingerprints
- intent/idempotency metadata

That gives us drift detection in code review and CI.

## What Signet should not adopt

### 1. Do not import the Trails runtime

The security and trust boundary here is different.

Signet is not a general-purpose contract framework. It is a security-sensitive XMTP runtime with very explicit custody and projection invariants. We should keep those guarantees local and obvious.

### 2. Do not force full topo/follow/detour machinery yet

Trails has a richer composition graph because that is part of its job.

Signet does not yet have a strong enough action-composition problem to justify importing that whole model. We should only borrow those pieces if we later discover real multi-action orchestration that wants authored follow-graphs.

### 3. Do not preserve the old contract model out of habit

The usual fear with contract changes is surface breakage.

That fear does not apply here yet.

So we should prefer:

- replace the thin contract with the better one
- update the transports in the same cutover
- publish HTTP only after it is sitting on the improved model

That is cleaner than building the public HTTP surface on top of a model we already expect to replace.

## Why this helps the outbound story too

This is not only about ingress.

If we strengthen the authored contract model now, the same discipline can later be applied to outbound delivery:

- canonical event contracts
- deterministic bridge projections
- adapter-specific overrides
- stable drift detection for webhook/SSE/queue/event-emitter modes

In other words:

- strong action contracts help ingress
- strong event contracts help egress

The bridge story gets easier if the contract story gets sharper first.

## Proposed migration order

### Phase 1. Cut over the authored contract

Replace the current thin `ActionSpec` model with a stronger authored contract that adds:

- `intent`
- `idempotent`
- `description`
- optional examples/metadata

Also add:

- `http` surface metadata
- generalized surface discovery
- registry validation hooks

This should be treated as a direct cutover inside `packages/contracts`, not as a compatibility layer.

### Phase 2. Add derivation helpers and validation

Create pure helpers for:

- HTTP method derivation from `intent`
- default route derivation from action ID
- MCP safety hints from `intent` and `idempotent`
- registry validation and collision detection

This is where the model becomes coherent.

### Phase 3. Move transports onto the derived model

Update:

- CLI
- MCP
- HTTP

so they all consume the same authored contract plus optional per-surface overrides.

At that point, the "define once, expose everywhere" story becomes more true than it is today.

### Phase 4. Add surface map / lock generation

Do this before the HTTP surface is treated as stable outside the repo.

That gives us a clean contract-governance story for future agent-facing work.

### Phase 5. Publish HTTP and use it as the first real proving ground

Once the cutover is done:

- expose the credential-scoped HTTP action surface
- keep the envelope and auth story simple
- let HTTP be the first public consumer of the stronger model

That is a much cleaner birth story for the surface than treating HTTP as the last adapter bolted onto the old model.

## Practical recommendation

If we want the best near-term payoff, the implementation order should be:

1. cut over `ActionSpec` and the registry to the stronger authored model
2. add deterministic derivation and validation
3. move CLI, MCP, and HTTP onto the same model in one pass
4. add drift detection before anyone external depends on the surface
5. then design the outbound bridge on top of the sharpened contract model

That is the path that uses our current freedom well instead of spending it on transitional code we do not actually need.

## Bottom line

We should absolutely let modern Trails lessons feed back into Signet.

But the right way to do that is:

- copy the contract ideas, not the dependency
- treat this as a cutover while we still can
- strengthen the authored action model before HTTP is published as a real surface
- keep Signet's security boundary and runtime semantics native to Signet

That should make the repo better immediately, and it should make the HTTP surface and outbound bridge work materially easier to build well.
