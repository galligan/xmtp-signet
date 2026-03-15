import { Command } from "commander";

/**
 * Conversation operation commands. Available in daemon and direct mode.
 *
 * - list: List conversations the broker participates in
 * - info: Show group metadata
 * - create: Create a new group conversation
 * - add-member: Add a member to a group
 */
export function createConversationCommands(): Command {
  const cmd = new Command("conversation").description(
    "Conversation operations",
  );

  cmd
    .command("list")
    .description("List conversations")
    .option("--limit <n>", "Maximum number of conversations")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient or DirectClient
    });

  cmd
    .command("info")
    .description("Show group conversation details")
    .argument("<group>", "Group conversation ID")
    .option("--json", "JSON output")
    .action(async (_group, _options) => {
      // Routed via AdminClient or DirectClient
    });

  cmd
    .command("create")
    .description("Create a new group conversation")
    .option("--members <inboxIds>", "Comma-separated member inbox IDs")
    .option("--json", "JSON output")
    .action(async (_options) => {
      // Routed via AdminClient or DirectClient
    });

  cmd
    .command("add-member")
    .description("Add a member to a group conversation")
    .argument("<group>", "Group conversation ID")
    .argument("<inboxId>", "Member inbox ID to add")
    .option("--json", "JSON output")
    .action(async (_group, _inboxId, _options) => {
      // Routed via AdminClient or DirectClient
    });

  return cmd;
}
