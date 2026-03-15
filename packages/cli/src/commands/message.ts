import { Command } from "commander";

/**
 * Message operation commands. Available in daemon and direct mode.
 *
 * - send: Send a text message to a group
 * - list: List recent messages in a group
 * - stream: Stream messages in real time (NDJSON with --json)
 */
export function createMessageCommands(): Command {
  const cmd = new Command("message").description("Message operations");

  cmd
    .command("send")
    .description("Send a text message to a group conversation")
    .argument("<group>", "Group conversation ID")
    .argument("<text>", "Message text")
    .option("--json", "JSON output")
    .action(async (_group, _text, _options) => {
      // Routed via AdminClient or DirectClient
    });

  cmd
    .command("list")
    .description("List recent messages in a group")
    .argument("<group>", "Group conversation ID")
    .option("--limit <n>", "Maximum number of messages", "25")
    .option("--before <timestamp>", "List messages before timestamp")
    .option("--json", "JSON output")
    .action(async (_group, _options) => {
      // Routed via AdminClient or DirectClient
    });

  cmd
    .command("stream")
    .description("Stream messages from a group in real time")
    .argument("<group>", "Group conversation ID")
    .option("--json", "NDJSON output (one JSON object per line)")
    .action(async (_group, _options) => {
      // Routed via AdminClient or DirectClient
      // Streaming: keeps socket open, prints NDJSON or formatted text
      // Exits on SIGINT (exit code 130)
    });

  return cmd;
}
