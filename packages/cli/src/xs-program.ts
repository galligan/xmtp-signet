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
import { createAgentCommands } from "./commands/xs-agent.js";
import { createOperatorCommands } from "./commands/xs-operator.js";
import { createCredentialCommands } from "./commands/xs-credential.js";
import { createChatCommands } from "./commands/xs-chat.js";
import { createMessageCommands } from "./commands/xs-message.js";
import { createPolicyCommands } from "./commands/xs-policy.js";
import { createSealCommands } from "./commands/xs-seal.js";
import { createWalletCommands } from "./commands/xs-wallet.js";
import { createKeyCommands } from "./commands/xs-key.js";
import { createInboxCommands } from "./commands/xs-inbox.js";
import { createUtilityCommands } from "./commands/xs-utility.js";

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
 * - Groups: daemon, operator, cred, inbox, chat, msg, policy, seal, wallet, key, consent
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

  // Utility commands (logs, lookup, search, consent) replace stubs
  for (const cmd of createUtilityCommands()) {
    program.addCommand(cmd);
  }

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

  // --- agent ---

  program.addCommand(createAgentCommands());

  // --- cred ---

  program.addCommand(createCredentialCommands());

  // --- inbox ---

  program.addCommand(createInboxCommands());

  // --- chat ---

  program.addCommand(createChatCommands());

  // --- msg ---

  program.addCommand(createMessageCommands());

  // --- policy ---

  program.addCommand(createPolicyCommands());

  // --- seal ---

  program.addCommand(createSealCommands());

  // --- wallet ---

  program.addCommand(createWalletCommands());

  // --- key ---

  program.addCommand(createKeyCommands());

  return program;
}
