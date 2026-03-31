import { describe, expect, test } from "bun:test";
import type { Command } from "commander";

/**
 * Tests for the chat and message command structures.
 *
 * These verify the Commander.js command tree matches the v1 spec:
 * subcommands exist with correct options, arguments, and descriptions.
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
// Chat commands
// ---------------------------------------------------------------------------

describe("chat commands", () => {
  async function load() {
    const { createChatCommands } = await import("../commands/xs-chat.js");
    return createChatCommands();
  }

  test("top-level command is named chat", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("chat");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  // -- create --

  test("create subcommand has --name required option", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
    expect(flags).toContain("--name");
  });

  test("create subcommand has --as, --op, --json options", async () => {
    const cmd = await load();
    const create = findSub(cmd, "create");
    expect(create).toBeDefined();
    const flags = optionFlags(create!);
    expect(flags).toContain("--as");
    expect(flags).toContain("--op");
    expect(flags).toContain("--json");
  });

  // -- list --

  test("list subcommand has --op, --watch, --json options", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--op");
    expect(flags).toContain("--watch");
    expect(flags).toContain("--json");
  });

  // -- info --

  test("info subcommand accepts an id argument", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  test("info subcommand has --only and --json options", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const flags = optionFlags(info!);
    expect(flags).toContain("--only");
    expect(flags).toContain("--json");
  });

  // -- update --

  test("update subcommand accepts an id argument", async () => {
    const cmd = await load();
    const update = findSub(cmd, "update");
    expect(update).toBeDefined();
    const args = update!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  test("update subcommand has --name, --description, --image options", async () => {
    const cmd = await load();
    const update = findSub(cmd, "update");
    expect(update).toBeDefined();
    const flags = optionFlags(update!);
    expect(flags).toContain("--name");
    expect(flags).toContain("--description");
    expect(flags).toContain("--image");
  });

  // -- sync --

  test("sync subcommand accepts optional id argument", async () => {
    const cmd = await load();
    const sync = findSub(cmd, "sync");
    expect(sync).toBeDefined();
  });

  // -- join --

  test("join subcommand accepts a url argument and --as option", async () => {
    const cmd = await load();
    const join = findSub(cmd, "join");
    expect(join).toBeDefined();
    const args = join!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("url");
    const flags = optionFlags(join!);
    expect(flags).toContain("--as");
  });

  // -- invite --

  test("invite subcommand accepts an id argument", async () => {
    const cmd = await load();
    const invite = findSub(cmd, "invite");
    expect(invite).toBeDefined();
    const args = invite!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  // -- leave --

  test("leave subcommand accepts an id argument", async () => {
    const cmd = await load();
    const leave = findSub(cmd, "leave");
    expect(leave).toBeDefined();
    const args = leave!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("id");
  });

  // -- rm --

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

  // -- member subgroup --

  test("member subcommand group exists with list, add, rm, promote, demote", async () => {
    const cmd = await load();
    const member = findSub(cmd, "member");
    expect(member).toBeDefined();
    const names = member!.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(["list", "add", "rm", "promote", "demote"]),
    );
    expect(member!.commands.length).toBe(5);
  });

  // -- total count --

  test("has 10 direct subcommands (including member group)", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Message commands
// ---------------------------------------------------------------------------

describe("message commands", () => {
  async function load() {
    const { createMessageCommands } = await import("../commands/xs-message.js");
    return createMessageCommands();
  }

  test("top-level command is named msg", async () => {
    const cmd = await load();
    expect(cmd.name()).toBe("msg");
  });

  test("has description", async () => {
    const cmd = await load();
    expect(cmd.description()).toBeTruthy();
  });

  // -- send --

  test("send subcommand accepts a text argument", async () => {
    const cmd = await load();
    const send = findSub(cmd, "send");
    expect(send).toBeDefined();
    const args = send!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("text");
  });

  test("send subcommand has --to required option and --as, --op, --json", async () => {
    const cmd = await load();
    const send = findSub(cmd, "send");
    expect(send).toBeDefined();
    const flags = optionFlags(send!);
    expect(flags).toContain("--to");
    expect(flags).toContain("--as");
    expect(flags).toContain("--op");
    expect(flags).toContain("--json");
  });

  // -- reply --

  test("reply subcommand accepts a text argument and --chat, --to options", async () => {
    const cmd = await load();
    const reply = findSub(cmd, "reply");
    expect(reply).toBeDefined();
    const args = reply!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("text");
    const flags = optionFlags(reply!);
    expect(flags).toContain("--chat");
    expect(flags).toContain("--to");
    expect(flags).toContain("--as");
    expect(flags).toContain("--json");
  });

  // -- react --

  test("react subcommand accepts an emoji argument and --chat, --to options", async () => {
    const cmd = await load();
    const react = findSub(cmd, "react");
    expect(react).toBeDefined();
    const args = react!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("emoji");
    const flags = optionFlags(react!);
    expect(flags).toContain("--chat");
    expect(flags).toContain("--to");
    expect(flags).toContain("--as");
  });

  // -- read --

  test("read subcommand has --chat required option and --as, --json", async () => {
    const cmd = await load();
    const read = findSub(cmd, "read");
    expect(read).toBeDefined();
    expect(read!.registeredArguments.length).toBe(0);
    const flags = optionFlags(read!);
    expect(flags).toContain("--chat");
    expect(flags).toContain("--as");
    expect(flags).toContain("--json");
  });

  // -- list --

  test("list subcommand has --from required option and --watch, --json", async () => {
    const cmd = await load();
    const list = findSub(cmd, "list");
    expect(list).toBeDefined();
    const flags = optionFlags(list!);
    expect(flags).toContain("--from");
    expect(flags).toContain("--as");
    expect(flags).toContain("--watch");
    expect(flags).toContain("--json");
  });

  // -- info --

  test("info subcommand accepts a msg-id argument and --chat, --as, --json options", async () => {
    const cmd = await load();
    const info = findSub(cmd, "info");
    expect(info).toBeDefined();
    const args = info!.registeredArguments;
    expect(args.length).toBeGreaterThanOrEqual(1);
    expect(args[0]?.name()).toBe("msg-id");
    const flags = optionFlags(info!);
    expect(flags).toContain("--chat");
    expect(flags).toContain("--as");
    expect(flags).toContain("--json");
  });

  // -- total count --

  test("has exactly 6 subcommands", async () => {
    const cmd = await load();
    expect(cmd.commands.length).toBe(6);
    const names = cmd.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "send",
        "reply",
        "react",
        "read",
        "list",
        "info",
      ]),
    );
  });
});
