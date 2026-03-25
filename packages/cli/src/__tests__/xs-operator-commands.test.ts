import { describe, expect, test } from "bun:test";
import type { Command } from "commander";

/**
 * Tests for the operator and credential command structures.
 *
 * These verify the Commander.js command tree matches the v1 spec:
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

describe("operator commands", () => {
  // Lazy import so test file can be written before implementation exists
  async function load() {
    const { createOperatorCommands } =
      await import("../commands/xs-operator.js");
    return createOperatorCommands();
  }

  test("top-level command is named operator", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("operator");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("create subcommand has --label required option", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
    expect(flags).toContain("--label");
  });

  test("create subcommand has --role, --scope, --provider options", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
    expect(flags).toContain("--role");
    expect(flags).toContain("--scope");
    expect(flags).toContain("--provider");
  });

  test("create subcommand has --json option", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
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
    // Commander stores registered args
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  test("rename subcommand accepts an id argument and --label option", async () => {
    const cmd = await load();
    const rename = findSub(cmd, "rename");
    expect(rename).toBeDefined();
    const args = rename!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(rename!);
    expect(flags).toContain("--label");
  });

  test("rm subcommand accepts an id argument and --force option", async () => {
    const cmd = await load();
    const rm = findSub(cmd, "rm");
    expect(rm).toBeDefined();
    const args = rm!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(rm!);
    expect(flags).toContain("--force");
  });

  test("has exactly 5 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(5);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["create", "list", "info", "rename", "rm"]),
    );
  });
});

describe("credential commands", () => {
  async function load() {
    const { createCredentialCommands } =
      await import("../commands/xs-credential.js");
    return createCredentialCommands();
  }

  test("top-level command is named cred", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("cred");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  test("issue subcommand has --config, --op, and --chat options", async () => {
    const cmd = await load();
    const issue = findSub(cmd, "issue");
    expect(issue).toBeDefined();
    const flags = optionFlags(issue!);
    expect(flags).toContain("--config");
    expect(flags).toContain("--op");
    expect(flags).toContain("--chat");
  });

  test("issue subcommand has --policy, --allow, --deny, --ttl, --json options", async () => {
    const cmd = await load();
    const issue = findSub(cmd, "issue");
    expect(issue).toBeDefined();
    const flags = optionFlags(issue!);
    expect(flags).toContain("--policy");
    expect(flags).toContain("--allow");
    expect(flags).toContain("--deny");
    expect(flags).toContain("--ttl");
    expect(flags).toContain("--json");
  });

  test("list subcommand has --config, --op, and --json options", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--config");
    expect(flags).toContain("--op");
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

  test("revoke subcommand accepts an id argument and --config, --force options", async () => {
    const cmd = await load();
    const revoke = findSub(cmd, "revoke");
    expect(revoke).toBeDefined();
    const args = revoke!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(revoke!);
    expect(flags).toContain("--config");
    expect(flags).toContain("--force");
    expect(flags).toContain("--json");
  });

  test("update subcommand accepts an id argument and --config plus scope options", async () => {
    const cmd = await load();
    const update = findSub(cmd, "update");
    expect(update).toBeDefined();
    const args = update!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
    const flags = optionFlags(update!);
    expect(flags).toContain("--config");
    expect(flags).toContain("--allow");
    expect(flags).toContain("--deny");
    expect(flags).toContain("--policy");
    expect(flags).toContain("--json");
  });

  test("issue rejects invalid ttl values", async () => {
    const { parsePositiveIntegerOption } = await import(
      "../commands/xs-credential.js"
    );
    expect(() => parsePositiveIntegerOption("10s")).toThrow(
      /positive integer/,
    );
    expect(() => parsePositiveIntegerOption("abc")).toThrow(
      /positive integer/,
    );
  });

  test("has exactly 5 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(5);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["issue", "list", "info", "revoke", "update"]),
    );
  });
});
