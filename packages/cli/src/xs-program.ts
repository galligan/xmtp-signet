/**
 * V1 `xs` program definition. Defines the top-level command structure
 * for the XMTP Signet CLI with subcommand group stubs.
 *
 * Steps 31-33 wire real implementations into these stubs.
 * @module
 */

import { Command } from "commander";
import { createLifecycleCommands } from "./commands/lifecycle.js";
import { createIdentityInitCommand } from "./commands/identity.js";
import { createOperatorCommands } from "./commands/xs-operator.js";
import { createCredentialCommands } from "./commands/xs-credential.js";

/** Placeholder action for stub commands not yet implemented. */
function stubAction(): void {
  process.stderr.write("This command is not yet implemented.\n");
  process.exit(1);
}

/** Create a subcommand stub with a placeholder action. */
function stub(name: string, description: string): Command {
  return new Command(name).description(description).action(stubAction);
}

function requireCommand(
  commands: readonly Command[],
  name: string,
  source: string,
): Command {
  const command = commands.find((candidate) => candidate.name() === name);
  if (!command) {
    throw new Error(`Missing ${source} command: ${name}`);
  }
  return command;
}

/**
 * Build the v1 `xs` program with all subcommand groups.
 *
 * The returned program has the v1 command taxonomy:
 * - Top-level: init, status, reset, logs, lookup, search
 * - Groups: daemon, operator, cred, chat, msg, policy, seal, wallet, key, consent
 */
export function createXsProgram(): Command {
  const program = new Command()
    .name("xs")
    .version("0.1.0")
    .description("XMTP Signet CLI");

  // --- Top-level commands ---

  program.addCommand(createIdentityInitCommand());
  program.addCommand(
    requireCommand(createLifecycleCommands(), "status", "lifecycle"),
  );
  program.addCommand(stub("reset", "Destructive reset of signet state"));
  program.addCommand(stub("logs", "View audit logs"));
  program.addCommand(
    stub("lookup", "Look up an address").argument(
      "<address>",
      "Address to look up",
    ),
  );
  program.addCommand(
    stub("search", "Search conversations and messages").argument(
      "<query>",
      "Search query",
    ),
  );

  // --- daemon ---

  const daemon = new Command("daemon").description(
    "Daemon lifecycle management",
  );
  const daemonLifecycle = createLifecycleCommands();
  daemon.addCommand(requireCommand(daemonLifecycle, "start", "lifecycle"));
  daemon.addCommand(requireCommand(daemonLifecycle, "stop", "lifecycle"));
  daemon.addCommand(requireCommand(daemonLifecycle, "status", "lifecycle"));
  program.addCommand(daemon);

  // --- operator ---

  program.addCommand(createOperatorCommands());

  // --- cred ---

  program.addCommand(createCredentialCommands());

  // --- chat ---

  const chat = new Command("chat").description("Chat management");
  chat.addCommand(stub("create", "Create a conversation"));
  chat.addCommand(stub("list", "List conversations"));
  chat.addCommand(stub("info", "Show conversation details"));
  program.addCommand(chat);

  // --- msg ---

  const msg = new Command("msg").description("Messaging");
  msg.addCommand(stub("send", "Send a message"));
  msg.addCommand(stub("reply", "Reply to a message"));
  msg.addCommand(stub("react", "React to a message"));
  program.addCommand(msg);

  // --- policy ---

  const policy = new Command("policy").description("Policy management");
  policy.addCommand(stub("create", "Create a policy"));
  policy.addCommand(stub("list", "List policies"));
  policy.addCommand(stub("info", "Show policy details"));
  policy.addCommand(stub("update", "Update a policy"));
  policy.addCommand(stub("rm", "Remove a policy"));
  program.addCommand(policy);

  // --- seal ---

  const seal = new Command("seal").description(
    "Seal inspection and verification",
  );
  seal.addCommand(stub("list", "List seals"));
  seal.addCommand(stub("info", "Show seal details"));
  seal.addCommand(stub("verify", "Verify a seal"));
  seal.addCommand(stub("history", "Show seal chain history"));
  program.addCommand(seal);

  // --- wallet ---

  const wallet = new Command("wallet").description("Wallet management");
  wallet.addCommand(stub("list", "List wallets"));
  wallet.addCommand(stub("info", "Show wallet details"));
  wallet.addCommand(stub("provider", "Manage wallet providers"));
  program.addCommand(wallet);

  // --- key ---

  const key = new Command("key").description("Key management");
  key.addCommand(stub("init", "Initialize key hierarchy"));
  key.addCommand(stub("rotate", "Rotate keys"));
  key.addCommand(stub("list", "List keys"));
  key.addCommand(stub("info", "Show key details"));
  program.addCommand(key);

  // --- consent ---

  const consent = new Command("consent").description("Consent management");
  consent.addCommand(stub("check", "Check consent state"));
  consent.addCommand(stub("allow", "Allow a contact"));
  consent.addCommand(stub("deny", "Deny a contact"));
  program.addCommand(consent);

  return program;
}
