import type { MessageVisibility } from "@xmtp/signet-schemas";

/**
 * Stage 3: Visibility resolver. Determines the MessageVisibility
 * for a message based on scopes and reveal state.
 *
 * - Has "read-messages" scope -> "visible"
 * - No "read-messages" + revealed -> "revealed"
 * - No "read-messages" + not revealed -> "hidden" (dropped by caller)
 */
export function resolveVisibility(
  scopes: ReadonlySet<string>,
  isRevealed: boolean,
): MessageVisibility {
  if (scopes.has("read-messages")) {
    return "visible";
  }
  return isRevealed ? "revealed" : "hidden";
}
