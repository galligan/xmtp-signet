---
name: tracer-bullet
description: "Walk through a feature end-to-end by executing each step live, pausing at failures to diagnose and fix before continuing. Use when testing a user story, running an end-to-end flow, validating that things actually work, doing a tracer bullet, smoke testing, or when the user says 'let's try it' or 'does this actually work'. Proactively use this when a feature has been implemented but never run for real."
---

# Tracer Bullet

Execute a user story step-by-step against real code, pausing at each failure to diagnose and fix before moving on. The goal is to find every gap between "tests pass" and "it actually works."

## How it works

1. **Define the journey** — list every step a real user would take, in order
2. **Execute each step** — run the actual command, call the actual API, connect the actual client
3. **At each step, observe** — did it succeed? What was the output? Was it what we expected?
4. **On failure, pause** — don't skip ahead. Diagnose the root cause, fix it, verify the fix, then continue
5. **Track progress** — maintain a checklist so we know where we are

## When a step fails

Follow this exact sequence:

1. **Capture the error** — full output, exit code, stack trace
2. **Classify** — is this a bug, a missing feature, a config issue, or an expected limitation?
3. **If bug or missing feature**: fix it now, run tests, verify the fix
4. **If config issue**: fix the config, document what was needed
5. **If expected limitation**: document it, note what's needed to close the gap, move on
6. **Re-run the step** to confirm it passes before advancing

## State tracking

Maintain a progress table in the conversation. Update it after each step:

```
Step | Action                          | Status | Notes
-----|--------------------------------|--------|------
1    | broker start                   | PASS   | ws://127.0.0.1:8393
2    | identity init                  | FAIL   | command is a stub
2a   |   fix: wire identity init      | DONE   | created vault + keys
2    | identity init (retry)          | PASS   | fingerprint: abc123
3    | admin token                    | ...    | not attempted yet
```

## Fixing protocol

When fixing a failure:

- Fix from the **top of the Graphite stack** (or current branch)
- Use `gt absorb -a -f` to route fixes to the correct branch
- Run `bun run build && bun run test && bun run typecheck && bun run lint` after each fix
- If the fix touches multiple packages, verify the full build
- Comment on affected PRs with what changed

## Key principles

- **No skipping.** Every step must pass before advancing. A tracer bullet that skips failures isn't testing anything.
- **Fix forward.** When something is broken, fix it — don't work around it. The whole point is to make the real path work.
- **Document gaps.** Some things genuinely can't be fixed right now (e.g., needs a running XMTP network node). Document these clearly as known limitations with what's needed to close them.
- **Small fixes.** Each fix should be the minimum change needed. Don't refactor the world — just make the current step work.
- **Verify twice.** After fixing, re-run the failing step AND re-run the previous step to make sure you didn't break it.
