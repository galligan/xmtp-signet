import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { createLifecycleCommands } from "../commands/lifecycle.js";
import { createIdentityCommands } from "../commands/identity.js";
import { createSessionCommands } from "../commands/session.js";
import { createGrantCommands } from "../commands/grant.js";
import { createSealCommands } from "../commands/seal.js";
import { createMessageCommands } from "../commands/message.js";
import { createConversationCommands } from "../commands/conversation.js";
import { createAdminCommands } from "../commands/admin.js";

function getSubcommandNames(cmd: Command): string[] {
  return cmd.commands.map((c) => c.name());
}

function hasOption(cmd: Command, flag: string): boolean {
  return cmd.options.some((o) => o.long === flag || o.short === flag);
}

function findSubcommand(parent: Command, name: string): Command | undefined {
  return parent.commands.find((c) => c.name() === name);
}

function findCommand(commands: Command[], name: string): Command | undefined {
  return commands.find((command) => command.name() === name);
}

describe("lifecycle commands", () => {
  const commands = createLifecycleCommands();

  test("registers the public top-level commands", () => {
    const names = commands.map((command) => command.name());
    expect(names).toContain("start");
    expect(names).toContain("stop");
    expect(names).toContain("status");
    expect(names).toContain("config");
  });

  test("start has --daemon and --config options", () => {
    const start = findCommand(commands, "start");
    expect(start).toBeDefined();
    expect(hasOption(start!, "--daemon")).toBe(true);
    expect(hasOption(start!, "--config")).toBe(true);
  });

  test("stop has --config and --timeout options", () => {
    const stop = findCommand(commands, "stop");
    expect(stop).toBeDefined();
    expect(hasOption(stop!, "--config")).toBe(true);
    expect(hasOption(stop!, "--timeout")).toBe(true);
  });

  test("status has --config and --json options", () => {
    const status = findCommand(commands, "status");
    expect(status).toBeDefined();
    expect(hasOption(status!, "--config")).toBe(true);
    expect(hasOption(status!, "--json")).toBe(true);
  });

  test("config has show and validate subcommands", () => {
    const config = findCommand(commands, "config");
    expect(config).toBeDefined();
    const configSubs = getSubcommandNames(config!);
    expect(configSubs).toContain("show");
    expect(configSubs).toContain("validate");
  });
});

describe("identity commands", () => {
  const cmd = createIdentityCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("init");
    expect(names).toContain("info");
    expect(names).toContain("rotate-keys");
    expect(names).toContain("export-public");
  });

  test("info has --json option", () => {
    const info = findSubcommand(cmd, "info");
    expect(info).toBeDefined();
    expect(hasOption(info!, "--json")).toBe(true);
  });
});

describe("session commands", () => {
  const cmd = createSessionCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("list");
    expect(names).toContain("inspect");
    expect(names).toContain("revoke");
    expect(names).toContain("issue");
  });

  test("list has --config, --agent, and --json options", () => {
    const list = findSubcommand(cmd, "list");
    expect(list).toBeDefined();
    expect(hasOption(list!, "--config")).toBe(true);
    expect(hasOption(list!, "--agent")).toBe(true);
    expect(hasOption(list!, "--json")).toBe(true);
  });

  test("revoke has --config and --reason options", () => {
    const revoke = findSubcommand(cmd, "revoke");
    expect(revoke).toBeDefined();
    expect(hasOption(revoke!, "--config")).toBe(true);
    expect(hasOption(revoke!, "--reason")).toBe(true);
  });

  test("issue has --config, --agent, --ttl, --view, --grant options", () => {
    const issue = findSubcommand(cmd, "issue");
    expect(issue).toBeDefined();
    expect(hasOption(issue!, "--config")).toBe(true);
    expect(hasOption(issue!, "--agent")).toBe(true);
    expect(hasOption(issue!, "--ttl")).toBe(true);
    expect(hasOption(issue!, "--view")).toBe(true);
    expect(hasOption(issue!, "--grant")).toBe(true);
  });
});

describe("grant commands", () => {
  const cmd = createGrantCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("list");
    expect(names).toContain("inspect");
    expect(names).toContain("revoke");
  });

  test("list has --session filter option", () => {
    const list = findSubcommand(cmd, "list");
    expect(list).toBeDefined();
    expect(hasOption(list!, "--session")).toBe(true);
  });
});

describe("seal commands", () => {
  const cmd = createSealCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("inspect");
    expect(names).toContain("verify");
    expect(names).toContain("history");
  });

  test("inspect has --json output", () => {
    const inspect = findSubcommand(cmd, "inspect");
    expect(inspect).toBeDefined();
    expect(hasOption(inspect!, "--json")).toBe(true);
  });
});

describe("message commands", () => {
  const cmd = createMessageCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("send");
    expect(names).toContain("list");
    expect(names).toContain("stream");
  });

  test("list has --limit and --before options", () => {
    const list = findSubcommand(cmd, "list");
    expect(list).toBeDefined();
    expect(hasOption(list!, "--limit")).toBe(true);
    expect(hasOption(list!, "--before")).toBe(true);
  });

  test("stream has --json option", () => {
    const stream = findSubcommand(cmd, "stream");
    expect(stream).toBeDefined();
    expect(hasOption(stream!, "--json")).toBe(true);
  });
});

describe("conversation commands", () => {
  const cmd = createConversationCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("list");
    expect(names).toContain("info");
    expect(names).toContain("create");
    expect(names).toContain("add-member");
  });

  test("list has --as, --config, and --json options", () => {
    const list = findSubcommand(cmd, "list");
    expect(list).toBeDefined();
    expect(hasOption(list!, "--as")).toBe(true);
    expect(hasOption(list!, "--config")).toBe(true);
    expect(hasOption(list!, "--json")).toBe(true);
  });

  test("create has --name, --members, --as, --config options", () => {
    const create = findSubcommand(cmd, "create");
    expect(create).toBeDefined();
    expect(hasOption(create!, "--name")).toBe(true);
    expect(hasOption(create!, "--members")).toBe(true);
    expect(hasOption(create!, "--as")).toBe(true);
    expect(hasOption(create!, "--config")).toBe(true);
  });

  test("info has --config and --json options", () => {
    const info = findSubcommand(cmd, "info");
    expect(info).toBeDefined();
    expect(hasOption(info!, "--config")).toBe(true);
    expect(hasOption(info!, "--json")).toBe(true);
  });

  test("add-member has --config and --json options", () => {
    const addMember = findSubcommand(cmd, "add-member");
    expect(addMember).toBeDefined();
    expect(hasOption(addMember!, "--config")).toBe(true);
    expect(hasOption(addMember!, "--json")).toBe(true);
  });
});

describe("admin commands", () => {
  const cmd = createAdminCommands();

  test("registers all subcommands", () => {
    const names = getSubcommandNames(cmd);
    expect(names).toContain("verify-keys");
    expect(names).toContain("export-state");
    expect(names).toContain("audit-log");
  });

  test("audit-log has --limit and --since options", () => {
    const auditLog = findSubcommand(cmd, "audit-log");
    expect(auditLog).toBeDefined();
    expect(hasOption(auditLog!, "--limit")).toBe(true);
    expect(hasOption(auditLog!, "--since")).toBe(true);
  });

  test("export-state has --json option", () => {
    const exportState = findSubcommand(cmd, "export-state");
    expect(exportState).toBeDefined();
    expect(hasOption(exportState!, "--json")).toBe(true);
  });
});

describe("all commands on program", () => {
  test("public commands are wired into the program", async () => {
    const { program } = await import("../index.js");
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("start");
    expect(names).toContain("stop");
    expect(names).toContain("status");
    expect(names).toContain("config");
    expect(names).toContain("identity");
    expect(names).toContain("session");
    expect(names).toContain("grant");
    expect(names).toContain("seal");
    expect(names).toContain("message");
    expect(names).toContain("conversation");
    expect(names).toContain("admin");
  });

  test("every leaf command supports --json", () => {
    // Collect all leaf commands (commands without subcommands)
    function collectLeafCommands(cmd: Command): Command[] {
      const leaves: Command[] = [];
      for (const sub of cmd.commands) {
        if (sub.commands.length === 0) {
          leaves.push(sub);
        } else {
          leaves.push(...collectLeafCommands(sub));
        }
      }
      return leaves;
    }

    const allCommands = [
      ...createLifecycleCommands(),
      createIdentityCommands(),
      createSessionCommands(),
      createGrantCommands(),
      createSealCommands(),
      createMessageCommands(),
      createConversationCommands(),
      createAdminCommands(),
    ];

    for (const group of allCommands) {
      const leaves = collectLeafCommands(group);
      for (const leaf of leaves) {
        // start and stop don't need --json output; config validate is special too
        // but the spec says "all commands" so we check for it
        const _name = `${group.name()} ${leaf.name()}`;
        expect(hasOption(leaf, "--json")).toBe(true);
      }
    }
  });
});
