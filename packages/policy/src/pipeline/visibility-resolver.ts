import type { MessageVisibility, ViewMode } from "@xmtp-broker/schemas";

/**
 * Stage 3: Visibility resolver. Determines the MessageVisibility
 * for a message given the view mode and whether the message is revealed.
 *
 * | View Mode      | Default Visibility | With Active Reveal |
 * |----------------|--------------------|--------------------|
 * | full           | visible            | visible            |
 * | thread-only    | visible            | visible            |
 * | redacted       | redacted           | revealed           |
 * | reveal-only    | hidden             | revealed           |
 * | summary-only   | redacted           | revealed           |
 */
export function resolveVisibility(
  mode: ViewMode,
  isRevealed: boolean,
): MessageVisibility {
  switch (mode) {
    case "full":
    case "thread-only":
      return "visible";
    case "redacted":
      return isRevealed ? "revealed" : "redacted";
    case "reveal-only":
      return isRevealed ? "revealed" : "hidden";
    case "summary-only":
      return isRevealed ? "revealed" : "redacted";
  }
}
