import { describe, expect, test, beforeEach } from "bun:test";
import { ClientRegistry } from "../client-registry.js";
import type { ManagedClient } from "../client-registry.js";
import { createMockXmtpClient } from "./fixtures.js";

let registry: ClientRegistry;

beforeEach(() => {
  registry = new ClientRegistry();
});

function makeManagedClient(identityId: string, inboxId: string): ManagedClient {
  return {
    identityId,
    inboxId,
    client: createMockXmtpClient({ inboxId }),
    groupIds: new Set<string>(),
  };
}

describe("ClientRegistry", () => {
  describe("register", () => {
    test("registers a client by identity ID", () => {
      const managed = makeManagedClient("id-1", "inbox-1");
      registry.register(managed);

      expect(registry.get("id-1")).toBe(managed);
    });

    test("overwrites existing registration", () => {
      const first = makeManagedClient("id-1", "inbox-a");
      const second = makeManagedClient("id-1", "inbox-b");

      registry.register(first);
      registry.register(second);

      expect(registry.get("id-1")?.inboxId).toBe("inbox-b");
    });
  });

  describe("get", () => {
    test("returns undefined for unregistered identity", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getByGroupId", () => {
    test("returns client managing a group", () => {
      const managed = makeManagedClient("id-1", "inbox-1");
      managed.groupIds.add("group-abc");
      registry.register(managed);

      expect(registry.getByGroupId("group-abc")).toBe(managed);
    });

    test("returns undefined for unregistered group", () => {
      expect(registry.getByGroupId("unknown")).toBeUndefined();
    });
  });

  describe("unregister", () => {
    test("removes a registered client", () => {
      const managed = makeManagedClient("id-1", "inbox-1");
      registry.register(managed);
      const removed = registry.unregister("id-1");

      expect(removed).toBe(true);
      expect(registry.get("id-1")).toBeUndefined();
    });

    test("returns false for unregistered identity", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    test("returns empty array when empty", () => {
      expect(registry.list()).toHaveLength(0);
    });

    test("returns all registered clients", () => {
      registry.register(makeManagedClient("id-1", "inbox-1"));
      registry.register(makeManagedClient("id-2", "inbox-2"));

      const list = registry.list();
      expect(list).toHaveLength(2);
    });
  });

  describe("size", () => {
    test("tracks registration count", () => {
      expect(registry.size).toBe(0);

      registry.register(makeManagedClient("id-1", "inbox-1"));
      expect(registry.size).toBe(1);

      registry.register(makeManagedClient("id-2", "inbox-2"));
      expect(registry.size).toBe(2);

      registry.unregister("id-1");
      expect(registry.size).toBe(1);
    });
  });

  describe("clear", () => {
    test("removes all clients", () => {
      registry.register(makeManagedClient("id-1", "inbox-1"));
      registry.register(makeManagedClient("id-2", "inbox-2"));
      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.list()).toHaveLength(0);
    });
  });
});
