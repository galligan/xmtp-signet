import { Result } from "better-result";
import { NotFoundError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "./identity-store.js";

/** Normalized identity match used by action handlers after selector lookup. */
export interface ResolvedIdentitySelection {
  readonly identityId: string;
  readonly inboxId: string | null;
}

function toResolvedIdentity(identity: {
  readonly id: string;
  readonly inboxId: string | null;
}): ResolvedIdentitySelection {
  return {
    identityId: identity.id,
    inboxId: identity.inboxId,
  };
}

/**
 * Resolve an acting identity from either a label or a registered inbox ID.
 *
 * Label matching keeps precedence so existing label-based flows behave exactly
 * as before even if a label could also look like an inbox identifier.
 */
export async function resolveIdentitySelector(
  identityStore: SqliteIdentityStore,
  selector: string | undefined,
): Promise<Result<ResolvedIdentitySelection, SignetError>> {
  if (selector !== undefined) {
    const byLabel = await identityStore.getByLabel(selector);
    if (byLabel !== null) {
      return Result.ok(toResolvedIdentity(byLabel));
    }

    const byInboxId = await identityStore.getByInboxId(selector);
    if (byInboxId !== null) {
      return Result.ok(toResolvedIdentity(byInboxId));
    }

    return Result.err(
      NotFoundError.create("identity", selector) as SignetError,
    );
  }

  const identities = await identityStore.list();
  const first = identities[0];
  if (!first) {
    return Result.err(
      NotFoundError.create("identity", "(none)") as SignetError,
    );
  }

  return Result.ok(toResolvedIdentity(first));
}
