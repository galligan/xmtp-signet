import { describe, expect, test } from "bun:test";
import { createXsProgram } from "../xs-program.js";

describe("xs program identity", () => {
  test("program name is xs", () => {
    const program = createXsProgram();
    expect(program.name()).toBe("xs");
  });

  test("program description is XMTP Signet CLI", () => {
    const program = createXsProgram();
    expect(program.description()).toBe("XMTP Signet CLI");
  });
});

describe("v1 top-level commands", () => {
  test("registers init as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("init");
  });

  test("registers status as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("status");
  });

  test("registers reset as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("reset");
  });

  test("registers logs as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("logs");
  });

  test("registers lookup as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("lookup");
  });

  test("registers search as a top-level command", () => {
    const program = createXsProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("search");
  });
});

describe("v1 subcommand groups", () => {
  test("daemon group has start, stop, status subcommands", () => {
    const program = createXsProgram();
    const daemon = program.commands.find((c) => c.name() === "daemon");
    expect(daemon).toBeDefined();
    const subs = daemon!.commands.map((c) => c.name());
    expect(subs).toContain("start");
    expect(subs).toContain("stop");
    expect(subs).toContain("status");
  });

  test("operator group has create, list, info, rename, rm subcommands", () => {
    const program = createXsProgram();
    const operator = program.commands.find((c) => c.name() === "operator");
    expect(operator).toBeDefined();
    const subs = operator!.commands.map((c) => c.name());
    expect(subs).toContain("create");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("rename");
    expect(subs).toContain("rm");
  });

  test("agent group has setup, status, doctor subcommands", () => {
    const program = createXsProgram();
    const agent = program.commands.find((c) => c.name() === "agent");
    expect(agent).toBeDefined();
    const subs = agent!.commands.map((c) => c.name());
    expect(subs).toContain("setup");
    expect(subs).toContain("status");
    expect(subs).toContain("doctor");
  });

  test("cred group has issue, list, info, revoke, update subcommands", () => {
    const program = createXsProgram();
    const cred = program.commands.find((c) => c.name() === "cred");
    expect(cred).toBeDefined();
    const subs = cred!.commands.map((c) => c.name());
    expect(subs).toContain("issue");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("revoke");
    expect(subs).toContain("update");
  });

  test("inbox group has create, list, info, rm, link, unlink subcommands", () => {
    const program = createXsProgram();
    const inbox = program.commands.find((c) => c.name() === "inbox");
    expect(inbox).toBeDefined();
    const subs = inbox!.commands.map((c) => c.name());
    expect(subs).toContain("create");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("rm");
    expect(subs).toContain("link");
    expect(subs).toContain("unlink");
  });

  test("chat group has create, list, info subcommands", () => {
    const program = createXsProgram();
    const chat = program.commands.find((c) => c.name() === "chat");
    expect(chat).toBeDefined();
    const subs = chat!.commands.map((c) => c.name());
    expect(subs).toContain("create");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
  });

  test("msg group has send, reply, react subcommands", () => {
    const program = createXsProgram();
    const msg = program.commands.find((c) => c.name() === "msg");
    expect(msg).toBeDefined();
    const subs = msg!.commands.map((c) => c.name());
    expect(subs).toContain("send");
    expect(subs).toContain("reply");
    expect(subs).toContain("react");
  });

  test("policy group has create, list, info, update, rm subcommands", () => {
    const program = createXsProgram();
    const pol = program.commands.find((c) => c.name() === "policy");
    expect(pol).toBeDefined();
    const subs = pol!.commands.map((c) => c.name());
    expect(subs).toContain("create");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("update");
    expect(subs).toContain("rm");
  });

  test("seal group has list, info, verify, history subcommands", () => {
    const program = createXsProgram();
    const seal = program.commands.find((c) => c.name() === "seal");
    expect(seal).toBeDefined();
    const subs = seal!.commands.map((c) => c.name());
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("verify");
    expect(subs).toContain("history");
  });

  test("wallet group has create, list, info, provider subcommands", () => {
    const program = createXsProgram();
    const wallet = program.commands.find((c) => c.name() === "wallet");
    expect(wallet).toBeDefined();
    const subs = wallet!.commands.map((c) => c.name());
    expect(subs).toContain("create");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
    expect(subs).toContain("provider");
  });

  test("key group has init, rotate, list, info subcommands", () => {
    const program = createXsProgram();
    const key = program.commands.find((c) => c.name() === "key");
    expect(key).toBeDefined();
    const subs = key!.commands.map((c) => c.name());
    expect(subs).toContain("init");
    expect(subs).toContain("rotate");
    expect(subs).toContain("list");
    expect(subs).toContain("info");
  });

  test("consent group has check, allow, deny subcommands", () => {
    const program = createXsProgram();
    const consent = program.commands.find((c) => c.name() === "consent");
    expect(consent).toBeDefined();
    const subs = consent!.commands.map((c) => c.name());
    expect(subs).toContain("check");
    expect(subs).toContain("allow");
    expect(subs).toContain("deny");
  });
});
