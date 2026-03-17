# Content Type Allowlists

## How content types flow through the signet

XMTP messages carry typed content — text, reactions, replies, read receipts,
group updates, and custom types defined through the XIP process. The signet
filters which content types reach each agent.

## Three-tier allowlist

The effective allowlist for any agent is the **intersection** of three levels:

### 1. Baseline allowlist

Content types that have passed through the XIP process and are accepted into
the XMTP spec. These are allowed by default at the protocol level.

Current baseline types:
- `text` — Plain text messages
- `reaction` — Emoji reactions
- `reply` — Threaded replies
- `readReceipt` — Read receipt signals
- `groupUpdated` — Group metadata changes

### 2. Broker-level configuration

The signet operator can expand or restrict beyond the baseline across all
agents the signet manages. For example, a signet might:

- **Restrict:** Block `readReceipt` to reduce metadata leakage
- **Expand:** Allow custom content types specific to the application

### 3. Per-agent view configuration

The agent owner can further scope what a specific agent sees, within what the
signet allows. This is part of the view configuration.

## Effective allowlist resolution

```
Effective = Baseline ∩ Broker Config ∩ Agent View Config
```

If a content type is not in the effective allowlist, the signet holds the
message and the agent never sees it. The raw message stays in the signet's
XMTP database — it's not deleted, just not forwarded.

## Default-deny for new types

When the XMTP spec adds a new content type:

1. The baseline list updates to include it
2. Existing signet configurations are unchanged
3. Existing agent views are unchanged
4. **The agent does NOT automatically start seeing the new type**

To receive the new type, the agent's view configuration must be updated to
explicitly include it. This prevents agents from receiving unexpected content
types after protocol updates.

## Content type schemas

Each content type has a Zod schema in `@xmtp/signet-schemas` that validates
the payload structure:

| Content type | Schema | Payload shape |
|-------------|--------|---------------|
| `text` | `TextPayload` | `{ text: string }` |
| `reaction` | `ReactionPayload` | `{ emoji: string, action: "added" \| "removed", referenceId: string }` |
| `reply` | `ReplyPayload` | `{ referenceId: string, content: string }` |
| `readReceipt` | `ReadReceiptPayload` | `{}` (presence only) |
| `groupUpdated` | `GroupUpdatedPayload` | `{ initiatedByInboxId: string, ... }` |

Custom content types follow the same pattern — define a Zod schema, register
it in `CONTENT_TYPE_SCHEMAS`, and add it to the appropriate allowlist tier.
