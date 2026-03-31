import { describe, expect, test } from "bun:test";
import type { Command } from "commander";

/**
 * Tests for the policy, seal, wallet, key, and utility command structures.
 *
 * Verifies the Commander.js command tree matches the v1 spec:
 * options, arguments, and descriptions are all wired correctly.
 */

/** Helper to find a subcommand by name. */
function findSub(parent: Command, name: string): Command | undefined {
  return parent.commands.find((c) => c.name() === name);
}

/** Helper to get option flags from a command. */
function optionFlags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long ?? o.short ?? "");
}

// ---------------------------------------------------------------------------
// Policy commands
// ---------------------------------------------------------------------------

describe("policy commands", () => {
  async function load() {
    const { createPolicyCommands } = await import("../commands/xs-policy.js");
    return createPolicyCommands();
  }

  test("top-level command is named policy", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("policy");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("create subcommand has --label, --allow, --deny, --json options", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
    expect(flags).toContain("--label");
    expect(flags).toContain("--allow");
    expect(flags).toContain("--deny");
    expect(flags).toContain("--json");
  });

  test("list subcommand has --json option", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--json");
  });

  test("info subcommand accepts an id argument", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  test("update subcommand accepts an id argument and scope options", async () => {
    const cmd = await load();
    const update = findSub(cmd, "update");
    expect(update).toBeDefined();
    const args = update!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(update!);
    expect(flags).toContain("--allow");
    expect(flags).toContain("--deny");
    expect(flags).toContain("--label");
  });

  test("rm subcommand accepts an id argument and --json option", async () => {
    const cmd = await load();
    const rm = findSub(cmd, "rm");
    expect(rm).toBeDefined();
    const args = rm!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(rm!);
    expect(flags).toContain("--json");
  });

  test("has exactly 5 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(5);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["create", "list", "info", "update", "rm"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Seal commands
// ---------------------------------------------------------------------------

describe("seal commands", () => {
  async function load() {
    const { createSealCommands } = await import("../commands/xs-seal.js");
    return createSealCommands();
  }

  test("top-level command is named seal", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("seal");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("list subcommand has --json option", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--json");
  });

  test("info subcommand accepts an id argument and has --json option", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(info!);
    expect(flags).toContain("--json");
  });

  test("verify subcommand accepts an id argument", async () => {
    const cmd = await load();
    const verify = findSub(cmd, "verify");
    expect(verify).toBeDefined();
    const args = verify!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  test("history subcommand accepts a cred-id argument", async () => {
    const cmd = await load();
    const history = findSub(cmd, "history");
    expect(history).toBeDefined();
    const args = history!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("cred-id");
  });

  test("has exactly 4 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(4);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["list", "info", "verify", "history"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Wallet commands
// ---------------------------------------------------------------------------

describe("wallet commands", () => {
  async function load() {
    const { createWalletCommands } = await import("../commands/xs-wallet.js");
    return createWalletCommands();
  }

  test("top-level command is named wallet", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("wallet");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("list subcommand has --json option", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--json");
  });

  test("info subcommand accepts an id argument and has --json option", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(info!);
    expect(flags).toContain("--json");
  });

  test("provider subcommand has set and list nested commands", async () => {
    const cmd = await load();
    const provider = findSub(cmd, "provider");
    expect(provider).toBeDefined();
    const set = findSub(provider!, "set");
    expect(set).toBeDefined();
    const list = findSub(provider!, "list");
    expect(list).toBeDefined();
  });

  test("provider set accepts a name argument and --path option", async () => {
    const cmd = await load();
    const provider = findSub(cmd, "provider");
    expect(provider).toBeDefined();
    const set = findSub(provider!, "set");
    expect(set).toBeDefined();
    const args = set!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("name");
    const flags = optionFlags(set!);
    expect(flags).toContain("--path");
  });

  test("provider list has --json option", async () => {
    const cmd = await load();
    const provider = findSub(cmd, "provider");
    expect(provider).toBeDefined();
    const list = findSub(provider!, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--json");
  });

  test("has exactly 3 top-level subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(3);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["list", "info", "provider"]));
  });
});

// ---------------------------------------------------------------------------
// Key commands
// ---------------------------------------------------------------------------

describe("key commands", () => {
  async function load() {
    const { createKeyCommands } = await import("../commands/xs-key.js");
    return createKeyCommands();
  }

  test("top-level command is named key", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("key");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("init subcommand exists", async () => {
    const cmd = await load();
    const init = findSub(cmd, "init");
    expect(init).toBeDefined();
  });

  test("rotate subcommand exists", async () => {
    const cmd = await load();
    const rotate = findSub(cmd, "rotate");
    expect(rotate).toBeDefined();
  });

  test("list subcommand has --json option", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--json");
  });

  test("info subcommand accepts an id argument and has --json option", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(info!);
    expect(flags).toContain("--json");
  });

  test("has exactly 4 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(4);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["init", "rotate", "list", "info"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Utility commands (logs, lookup, search, consent)
// ---------------------------------------------------------------------------

describe("utility commands", () => {
  async function loadProgram() {
    const { createUtilityCommands } = await import("../commands/xs-utility.js");
    return createUtilityCommands();
  }

  test("exports a createUtilityCommands function", async () => {
    const { createUtilityCommands } = await import("../commands/xs-utility.js");
    expect(typeof createUtilityCommands).toBe("function");
  });

  test("returns an array of commands", async () => {
    const commands = await loadProgram();
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(0);
  });

  test("includes a logs command with --watch, --since, --limit, and --json options", async () => {
    const commands = await loadProgram();
    const logs = commands.find((c) => c.name() === "logs");
    expect(logs).toBeDefined();
    const flags = optionFlags(logs!);
    expect(flags).toContain("--watch");
    expect(flags).toContain("--since");
    expect(flags).toContain("--limit");
    expect(flags).toContain("--json");
  });

  test("logs command includes an export subcommand with --json", async () => {
    const commands = await loadProgram();
    const logs = commands.find((c) => c.name() === "logs");
    expect(logs).toBeDefined();
    const exportCmd = findSub(logs!, "export");
    expect(exportCmd).toBeDefined();
    expect(optionFlags(exportCmd!)).toContain("--json");
  });

  test("includes a lookup command with an address argument and --json", async () => {
    const commands = await loadProgram();
    const lookup = commands.find((c) => c.name() === "lookup");
    expect(lookup).toBeDefined();
    const args = lookup!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("address");
    expect(optionFlags(lookup!)).toContain("--json");
  });

  test("includes a search command with query argument, filter options, and --json", async () => {
    const commands = await loadProgram();
    const search = commands.find((c) => c.name() === "search");
    expect(search).toBeDefined();
    const args = search!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("query");
    const flags = optionFlags(search!);
    expect(flags).toContain("--chat");
    expect(flags).toContain("--op");
    expect(flags).toContain("--limit");
    expect(flags).toContain("--json");
  });

  test("includes a consent command with check, allow, deny subcommands", async () => {
    const commands = await loadProgram();
    const consent = commands.find((c) => c.name() === "consent");
    expect(consent).toBeDefined();
    const names = consent!.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["check", "allow", "deny"]));
  });

  test("consent check has entity argument and --as option", async () => {
    const commands = await loadProgram();
    const consent = commands.find((c) => c.name() === "consent");
    expect(consent).toBeDefined();
    const check = findSub(consent!, "check");
    expect(check).toBeDefined();
    const args = check!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("entity");
    const flags = optionFlags(check!);
    expect(flags).toContain("--as");
  });

  test("consent allow and deny accept entity argument", async () => {
    const commands = await loadProgram();
    const consent = commands.find((c) => c.name() === "consent");
    expect(consent).toBeDefined();
    const allow = findSub(consent!, "allow");
    expect(allow).toBeDefined();
    expect(allow!.registeredArguments[0]?.name()).toBe("entity");
    const deny = findSub(consent!, "deny");
    expect(deny).toBeDefined();
    expect(deny!.registeredArguments[0]?.name()).toBe("entity");
  });
});
