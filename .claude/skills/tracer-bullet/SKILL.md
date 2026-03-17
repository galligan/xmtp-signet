---
name: tracer-bullet
description: "Run end-to-end tracer bullets against the real xmtp-broker codebase. Executes user stories step-by-step, pausing at failures to diagnose and fix. Use when testing a user story, running an end-to-end flow, validating that things actually work, doing a tracer bullet, smoke testing, or when the user says 'let's try it' or 'does this actually work'. Proactively use this when a feature has been implemented but never run for real."
---

# Tracer Bullet

Run predefined user stories against the real broker, catch every gap between "tests pass" and "it actually works."

## Invocation

If the user doesn't specify which tracer bullet to run, use `AskUserQuestion` to let them pick:

| Option | Story | Needs |
|--------|-------|-------|
| **Admin flow** | identity init → broker start → admin token → session issue/list/inspect/revoke → broker stop | Keys + daemon |
| **Empty-dir boot** | broker start from empty data dir → verify listening → verify no implicit credentials → stop | Nothing |
| **WebSocket harness** | (after admin flow) connect WS with session token → denied send → allowed send → disconnect | Session token |
| **Full journey** | All of the above in sequence | Nothing |
| **Dev network** | dual-identity init → broker start → create group → session issue → WS send → receive → stop | Network access |
| **Production** | identity init (prod) → broker start → create group → invite QR → operator joins → exchange messages → stop | Network + external XMTP app |

If the user says "all" or "full", run the local stories (Admin flow → Empty-dir boot → WebSocket harness) in order. Dev network and Production are separate — they require network access and are opt-in.

If the user picks **Dev network** or **Production**, also ask which XMTP environment to use:

| Option | Environment | When to use |
|--------|-------------|-------------|
| **Dev** (Recommended) | `--env dev` | Testing and development. Creates ephemeral identities on devnet. |
| **Production** | `--env production` | Real-world interop. Identities persist. Use with caution. |

For the Production story, always use `--env production`. For Dev network, default to `--env dev` but allow the operator to override to production if they want to test real-world delivery without the interactive QR flow.

## Test environment

All tracer bullets run against deterministic temp directories under `.test/tracers/` (gitignored):

```
.test/tracers/<story-name>/
  config.toml          # generated config with free port + temp paths
  data/                # vault, identity store, DB files
  runtime/             # PID file, admin socket
  state/               # audit log
```

Before each story, create a fresh directory. After each story, leave artifacts for inspection. The config uses:
- A random free WS port (use port 0 or find-free-port)
- All paths pointing into the temp directory
- `env: "local"` (no real XMTP network unless explicitly testing that)

## Execution model

Each tracer bullet runs as a **subagent** so the main conversation stays clean. The subagent:

1. Creates the test environment
2. Executes each step using real CLI commands (`bun run packages/cli/src/bin.ts ...`)
3. On failure: classifies → fixes if possible → retries
4. Writes progress to a report file

### Subagent prompt template

```
Run the "{story_name}" tracer bullet for xmtp-broker.

Test directory: {test_dir}
Config file: {test_dir}/config.toml
CLI entry point: packages/cli/src/bin.ts

Steps:
{step_list}

Rules:
- Execute each step by running the real CLI command or connecting a real client.
- On failure: capture the full error, classify it (bug / missing feature / config / limitation), and fix if possible.
- After fixing, re-run the step to confirm it passes before advancing.
- Do NOT skip steps. Every step must pass or be documented as a known limitation.
- Write your progress report to: {report_path}
- Fix from the top of the Graphite stack. Use `gt absorb -a -f` to route fixes.
- Run `bun run build && bun run test && bun run typecheck && bun run lint` after any fix.
```

## Report format

Each tracer bullet writes a markdown report to `.test/tracers/<story-name>/REPORT.md`:

```markdown
# Tracer Bullet: {story_name}
**Date:** {iso_date}
**Duration:** {elapsed}
**Result:** {PASS | PARTIAL | FAIL}

## Steps

| # | Action | Status | Duration | Notes |
|---|--------|--------|----------|-------|
| 1 | broker start | PASS | 1.2s | ws://127.0.0.1:{port} |
| 2 | identity init | FIXED | 3.4s | wired command, see fix below |
| 3 | admin token | PASS | 0.8s | JWT generated |

## Fixes Applied

### Fix 1: {title}
**Step:** {step_number}
**Classification:** {bug | missing_feature | config}
**Files changed:** {list}
**Description:** {what and why}

## Known Limitations

- {description of what can't be fixed right now and what's needed}

## Environment

- Config: {config_path}
- Data dir: {data_dir}
- WS port: {port}
- Platform: {os} / {arch}
```

## After completion

After all requested stories finish:

1. Read each `REPORT.md` and present a summary to the user
2. If fixes were applied, note which files changed and suggest committing
3. If known limitations were found, note what's needed to close them

## Story definitions

### Admin Flow

```
1. Create test environment (config, directories)
2. identity init --config {config} --json
3. broker start --config {config} --json (background)
4. Wait for admin socket + WS port
5. admin token --config {config} --json
6. broker status --config {config} --json
7. session issue --config {config} --agent test-agent --view @{view_file} --grant @{grant_file} --json
8. session list --config {config} --agent test-agent --json
9. session inspect --config {config} {session_id} --json
10. session revoke --config {config} {session_id} --json
11. broker stop --config {config} --json
12. Verify: PID file cleaned up, port released, audit log has entries
```

### Empty-Dir Boot

```
1. Create test environment (config only, empty data dir)
2. Verify data dir does not exist
3. broker start --config {config} --json (background)
4. Wait for admin socket + WS port
5. broker status --config {config} --json
6. Verify: no admin key, no operational key, no XMTP identity created
7. Stop daemon via SIGTERM
8. Verify: PID file cleaned up, port released
```

### WebSocket Harness

Depends on a session token from Admin Flow (run Admin Flow first, or reuse existing test env).

```
1. Create test environment (or reuse from Admin Flow)
2. identity init + broker start + session issue (if not already done)
3. Connect WebSocket to ws://127.0.0.1:{port} with session token
4. Send auth frame, verify AuthenticatedFrame received
5. Send send_message for group NOT in session scope → expect permission error
6. Send send_message for group IN session scope → expect routed response
7. Send heartbeat → expect success
8. Disconnect WebSocket
9. broker stop --config {config} --json
```

### Full Journey

Run Admin Flow → Empty-Dir Boot → WebSocket Harness in sequence. Each gets its own test directory. Report combines all three.

### Dev Network

```
 1. Create test environment (config with env: "dev", temp dirs)
 2. identity init --env dev --label alice --config {config} --json
 3. identity init --env dev --label bob --config {config} --json
 4. Verify: two distinct inbox IDs returned
 5. broker start --config {config} --json (background)
 6. Wait for daemon ready + core state "running" (poll broker status)
 7. broker status --config {config} --json → verify 2 identities connected
 8. conversation create --name "tracer-test" --members {bob_inbox_id} --as alice --config {config} --json
 9. conversation list --config {config} --json → verify group exists
10. Generate view.json scoped to the created group:
    { "groups": ["{group_id}"], "contentTypes": ["xmtp.org/text:1.0"] }
11. Generate grant.json allowing send_message:
    { "actions": ["send_message"], "rateLimit": null }
12. session issue --config {config} --agent {alice_inbox_id} --view @view.json --grant @grant.json --json
13. Connect WebSocket with session token
14. Send auth frame → verify authenticated
15. Send send_message to the created group → expect success with messageId
16. Verify: message appears in broker's event stream (or poll conversation)
17. session issue for bob → connect second WS → verify bob receives the message
18. broker stop --config {config} --json
19. Verify: clean shutdown, PID file removed
```

**Config template for dev network:**
```toml
[broker]
env = "dev"

[broker.ws]
host = "127.0.0.1"
port = 0

[paths]
data_dir = "{test_dir}/data"
runtime_dir = "{test_dir}/runtime"
state_dir = "{test_dir}/state"
```

### Production

```
 1. Create test environment (config with env: "production", temp dirs)
 2. identity init --env production --label broker-agent --config {config} --json
 3. broker start --config {config} --json (background)
 4. Wait for daemon ready + core state "running"
 5. PAUSE: Ask operator for their XMTP inbox ID (displayed in their app)
    → Or the operator can provide an Ethereum address for lookup
 6. conversation create --name "broker-test-{date}" --members {operator_inbox_id} --as broker-agent --config {config} --json
    → Creates group with both broker and operator as members
 7. conversation invite {group_id} --format both --config {config}
    → Displays QR code and group info
    → Operator sees the group appear in their XMTP app automatically
 8. session issue --config {config} --agent {broker_inbox_id} --view @{view} --grant @{grant} --json
 9. Connect WebSocket with session token
10. Send send_message "Hello from the broker!" to the group
    → Operator sees the message in their XMTP app
11. PAUSE: Operator sends a reply from their XMTP app
    → Poll broker status or WS event stream until message from non-broker inbox arrives (120s timeout)
12. Verify: broker received the external message via event stream
13. broker stop --config {config} --json
14. Verify: clean shutdown
```
