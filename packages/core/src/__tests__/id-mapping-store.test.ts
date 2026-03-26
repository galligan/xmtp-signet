import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSqliteIdMappingStore } from "../id-mapping-store.js";
import type { IdMappingStore } from "@xmtp/signet-schemas";

describe("SqliteIdMappingStore", () => {
  let db: Database;
  let store: IdMappingStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createSqliteIdMappingStore(db);
  });

  describe("set", () => {
    test("stores a message mapping", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");
      const local = store.getLocal("xmtp_abc12345feedbabe");
      expect(local).toBe("msg_1234567890abcdef");
    });

    test("stores a conversation mapping", () => {
      store.set(
        "xmtp_def45678feedbabe",
        "conv_1234567890abcdef",
        "conversation",
      );
      const local = store.getLocal("xmtp_def45678feedbabe");
      expect(local).toBe("conv_1234567890abcdef");
    });

    test("stores an inbox mapping", () => {
      store.set("xmtp_ghi78901feedbabe", "inbox_1234567890abcdef", "inbox");
      const local = store.getLocal("xmtp_ghi78901feedbabe");
      expect(local).toBe("inbox_1234567890abcdef");
    });

    test("overwrites existing mapping for same network ID", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1111111111111111", "message");
      store.set("xmtp_abc12345feedbabe", "msg_2222222222222222", "message");
      const local = store.getLocal("xmtp_abc12345feedbabe");
      expect(local).toBe("msg_2222222222222222");
    });
  });

  describe("getLocal", () => {
    test("returns local ID for known network ID", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");
      expect(store.getLocal("xmtp_abc12345feedbabe")).toBe(
        "msg_1234567890abcdef",
      );
    });

    test("returns null for unknown network ID", () => {
      expect(store.getLocal("xmtp_unknown1feedbabe")).toBeNull();
    });
  });

  describe("getNetwork", () => {
    test("returns network ID for known local ID", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");
      expect(store.getNetwork("msg_1234567890abcdef")).toBe(
        "xmtp_abc12345feedbabe",
      );
    });

    test("returns null for unknown local ID", () => {
      expect(store.getNetwork("msg_unknown123456ab")).toBeNull();
    });
  });

  describe("resolve", () => {
    test("resolves by network ID", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");
      const result = store.resolve("xmtp_abc12345feedbabe");
      expect(result).toEqual({
        networkId: "xmtp_abc12345feedbabe",
        localId: "msg_1234567890abcdef",
      });
    });

    test("resolves by local ID", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");
      const result = store.resolve("msg_1234567890abcdef");
      expect(result).toEqual({
        networkId: "xmtp_abc12345feedbabe",
        localId: "msg_1234567890abcdef",
      });
    });

    test("returns null for unknown ID", () => {
      expect(store.resolve("unknown_id")).toBeNull();
    });
  });

  describe("persistence", () => {
    test("data survives across store instances on same db", () => {
      store.set("xmtp_abc12345feedbabe", "msg_1234567890abcdef", "message");

      // Create a new store instance on the same database
      const store2 = createSqliteIdMappingStore(db);
      expect(store2.getLocal("xmtp_abc12345feedbabe")).toBe(
        "msg_1234567890abcdef",
      );
    });
  });

  describe("multiple resource types", () => {
    test("stores mappings for different resource types independently", () => {
      store.set("xmtp_aaa11111feedbabe", "msg_1234567890abcdef", "message");
      store.set(
        "xmtp_bbb22222feedbabe",
        "conv_1234567890abcdef",
        "conversation",
      );
      store.set("xmtp_ccc33333feedbabe", "inbox_1234567890abcdef", "inbox");

      expect(store.getLocal("xmtp_aaa11111feedbabe")).toBe(
        "msg_1234567890abcdef",
      );
      expect(store.getLocal("xmtp_bbb22222feedbabe")).toBe(
        "conv_1234567890abcdef",
      );
      expect(store.getLocal("xmtp_ccc33333feedbabe")).toBe(
        "inbox_1234567890abcdef",
      );
    });
  });
});
