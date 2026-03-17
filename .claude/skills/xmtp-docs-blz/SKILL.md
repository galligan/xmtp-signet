---
name: xmtp-docs-blz
description: >
  Look up current XMTP documentation using the blz CLI. Use when you need to
  check XMTP SDK methods, group permissions, identity model, content types,
  MLS details, or any XMTP protocol or API question. Prevents hallucinating
  outdated SDK patterns.
  Use when: (1) looking up XMTP SDK methods or patterns, (2) verifying API
  signatures before writing code, (3) understanding XMTP protocol concepts
  (groups, MLS, inboxes, attestations), (4) checking content type schemas,
  (5) any question about how XMTP works.
---

# XMTP Documentation Lookup via blz

The `xmtp` source is indexed locally via `blz` and contains the full XMTP documentation (~16,700 lines, 833 sections). Always look up SDK patterns before writing XMTP code — the SDK evolves frequently.

## Workflow

### Step 1: Search for the topic

Use `blz query` to find relevant sections:

```bash
blz query -s xmtp "your search terms" --limit 5 --text
```

This returns ranked results with section paths and line numbers (e.g., `xmtp:7408-7408`).

**Tips for good queries:**
- Use 2-4 specific terms: `"group permissions admin"`
- Use `+term` to require a word: `"+signer +create +node"`
- Use quotes for exact phrases: `'"Client.create"'`
- Add `--block` to auto-expand results to their full section

### Step 2: Retrieve full content by line range

Once you have line numbers from search results, fetch the full content:

```bash
blz get xmtp:7408-7493 --raw
```

**Retrieval options:**
- `--raw` — clean content, best for reading code examples
- `-C 10` — add 10 lines of context before and after
- `-C all` — expand to the full containing section (very useful)
- `--block` — same as `-C all`, expand to heading boundary
- Multiple ranges: `blz get xmtp:7408-7493,9456-9530 --raw`

### Step 3: Browse structure (when you don't know what to search for)

List all documentation sections:

```bash
# Top-level sections only
blz map xmtp -H "<=2" --text

# All sections matching a filter
blz map xmtp --filter "group" --text

# Full tree view
blz map xmtp --tree --text
```

## One-Shot Pattern (Recommended Default)

For most lookups, a single command gets you everything:

```bash
blz query -s xmtp "your query" --limit 3 -C all --text
```

This searches, ranks results, and expands each hit to its full section — usually enough context in one call.

## Key XMTP Documentation Sections

| Topic | Search terms |
|-------|-------------|
| Node SDK setup | `"node SDK" +create +client` |
| Creating groups | `+create +group +conversation` |
| Group permissions | `"group permissions"` |
| Identity / inboxes | `+identity +inbox +signer` |
| Content types | `"content type" +text +reaction` |
| MLS / encryption | `+MLS +encryption +epoch` |
| Streaming messages | `+stream +messages +conversation` |
| Consent / spam | `+consent +preferences +spam` |
| Push notifications | `"push notification"` |
| Agent SDK | `"agent SDK" +middleware` |

## Other Available Sources

Besides `xmtp`, these sources are also indexed in blz and may be useful:

- `bun` — Bun runtime docs (APIs, test runner, SQLite, etc.)
- `cloudflare` — Cloudflare Workers, D1, KV, etc.
- `turbo` — Turborepo docs
- `anthropic` — Claude API and platform docs

Query any source with `-s <alias>`, e.g., `blz query -s bun "websocket server" --limit 3 --text`.
