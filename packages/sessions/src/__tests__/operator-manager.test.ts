import { Result } from "better-result";
import { describe, expect, test, beforeEach } from "bun:test";
import type { OperatorConfigType } from "@xmtp/signet-schemas";
import {
  NotFoundError,
  ValidationError,
  PermissionError,
} from "@xmtp/signet-schemas";
import {
  createOperatorManager,
  type OperatorManagerInternal,
} from "../operator-manager.js";
import type { OperatorManager } from "@xmtp/signet-contracts";

function makeConfig(
  overrides: Partial<OperatorConfigType> = {},
): OperatorConfigType {
  return {
    label: "Test Operator",
    role: "operator",
    scopeMode: "per-chat",
    ...overrides,
  };
}

let manager: OperatorManager & OperatorManagerInternal;

beforeEach(() => {
  manager = createOperatorManager();
});

describe("createOperatorManager", () => {
  describe("create", () => {
    test("returns a record with op_ prefix ID", async () => {
      const result = await manager.create(makeConfig());
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.id).toMatch(/^op_[0-9a-f]{16}$/);
    });

    test("stores config fields in the record", async () => {
      const config = makeConfig({
        label: "My Agent",
        role: "admin",
        scopeMode: "shared",
      });
      const result = await manager.create(config);
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.config.label).toBe("My Agent");
      expect(result.value.config.role).toBe("admin");
      expect(result.value.config.scopeMode).toBe("shared");
    });

    test("sets status to active and createdBy to owner", async () => {
      const result = await manager.create(makeConfig());
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value.status).toBe("active");
      expect(result.value.createdBy).toBe("owner");
    });

    test("sets a valid ISO 8601 createdAt timestamp", async () => {
      const before = new Date();
      const result = await manager.create(makeConfig());
      const after = new Date();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      const created = new Date(result.value.createdAt);
      expect(created.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(created.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    test("returns ValidationError for empty label", async () => {
      const result = await manager.create(makeConfig({ label: "" }));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBeInstanceOf(ValidationError);
    });

    test("returns PermissionError when creating superadmin role", async () => {
      const result = await manager.create(makeConfig({ role: "superadmin" }));
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBeInstanceOf(PermissionError);
    });

    test("increments size after creation", async () => {
      expect(manager.size).toBe(0);
      await manager.create(makeConfig());
      expect(manager.size).toBe(1);
    });
  });

  describe("list", () => {
    test("returns empty array when no operators exist", async () => {
      const result = await manager.list();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toEqual([]);
    });

    test("returns all active operators", async () => {
      await manager.create(makeConfig({ label: "Op A" }));
      await manager.create(makeConfig({ label: "Op B" }));
      const result = await manager.list();
      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;
      expect(result.value).toHaveLength(2);
    });

    test("excludes removed operators", async () => {
      const createResult = await manager.create(makeConfig());
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      await manager.remove(createResult.value.id);
      const listResult = await manager.list();
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;
      expect(listResult.value).toHaveLength(0);
    });
  });

  describe("lookup", () => {
    test("returns operator by ID", async () => {
      const createResult = await manager.create(makeConfig({ label: "Found" }));
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      const lookupResult = await manager.lookup(createResult.value.id);
      expect(lookupResult.isOk()).toBe(true);
      if (!lookupResult.isOk()) return;
      expect(lookupResult.value.config.label).toBe("Found");
    });

    test("returns NotFoundError for unknown ID", async () => {
      const result = await manager.lookup("op_00000000feedbabe");
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBeInstanceOf(NotFoundError);
    });

    test("returns a defensive copy", async () => {
      const createResult = await manager.create(makeConfig({ label: "Found" }));
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;

      const lookupResult = await manager.lookup(createResult.value.id);
      expect(lookupResult.isOk()).toBe(true);
      if (!lookupResult.isOk()) return;

      lookupResult.value.config.label = "Mutated";

      const secondLookup = await manager.lookup(createResult.value.id);
      expect(secondLookup.isOk()).toBe(true);
      if (!secondLookup.isOk()) return;
      expect(secondLookup.value.config.label).toBe("Found");
    });
  });

  describe("update", () => {
    test("updates operator label", async () => {
      const createResult = await manager.create(makeConfig({ label: "Old" }));
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      const updateResult = await manager.update(createResult.value.id, {
        label: "New",
      });
      expect(updateResult.isOk()).toBe(true);
      if (!updateResult.isOk()) return;
      expect(updateResult.value.config.label).toBe("New");
      expect(updateResult.value.id).toBe(createResult.value.id);
    });

    test("returns NotFoundError for unknown ID", async () => {
      const result = await manager.update("op_00000000feedbabe", { label: "X" });
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBeInstanceOf(NotFoundError);
    });

    test("returns PermissionError when escalating to superadmin", async () => {
      const createResult = await manager.create(makeConfig({ role: "admin" }));
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      const updateResult = await manager.update(createResult.value.id, {
        role: "superadmin",
      });
      expect(updateResult.isErr()).toBe(true);
      if (!updateResult.isErr()) return;
      expect(updateResult.error).toBeInstanceOf(PermissionError);
    });

    test("returns ValidationError for empty label update", async () => {
      const createResult = await manager.create(makeConfig());
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      const updateResult = await manager.update(createResult.value.id, {
        label: "",
      });
      expect(updateResult.isErr()).toBe(true);
      if (!updateResult.isErr()) return;
      expect(updateResult.error).toBeInstanceOf(ValidationError);
    });
  });

  describe("remove", () => {
    test("sets status to removed", async () => {
      const createResult = await manager.create(makeConfig());
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;
      const removeResult = await manager.remove(createResult.value.id);
      expect(removeResult.isOk()).toBe(true);
      // Verify via lookup that status is removed
      const lookupResult = await manager.lookup(createResult.value.id);
      expect(lookupResult.isOk()).toBe(true);
      if (!lookupResult.isOk()) return;
      expect(lookupResult.value.status).toBe("removed");
    });

    test("returns NotFoundError for unknown ID", async () => {
      const result = await manager.remove("op_00000000feedbabe");
      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;
      expect(result.error).toBeInstanceOf(NotFoundError);
    });

    test("revokes associated credentials before removing operator", async () => {
      const revokeCalls: Array<{ operatorId: string; reason: string }> = [];
      const managerWithRevoker = createOperatorManager({
        revokeCredentials: async (operatorId, reason) => {
          revokeCalls.push({ operatorId, reason });
          return Result.ok(undefined);
        },
      });

      const createResult = await managerWithRevoker.create(makeConfig());
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;

      const removeResult = await managerWithRevoker.remove(
        createResult.value.id,
      );
      expect(removeResult.isOk()).toBe(true);
      expect(revokeCalls).toEqual([
        {
          operatorId: createResult.value.id,
          reason: "owner-initiated",
        },
      ]);
    });

    test("does not remove operator when credential revocation fails", async () => {
      const managerWithRevoker = createOperatorManager({
        revokeCredentials: async (operatorId) =>
          Result.err(
            PermissionError.create("revocation failed", {
              operatorId,
            }),
          ),
      });

      const createResult = await managerWithRevoker.create(makeConfig());
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;

      const removeResult = await managerWithRevoker.remove(
        createResult.value.id,
      );
      expect(removeResult.isErr()).toBe(true);
      if (!removeResult.isErr()) return;
      expect(removeResult.error).toBeInstanceOf(PermissionError);

      const lookupResult = await managerWithRevoker.lookup(
        createResult.value.id,
      );
      expect(lookupResult.isOk()).toBe(true);
      if (!lookupResult.isOk()) return;
      expect(lookupResult.value.status).toBe("active");
    });
  });

  describe("list", () => {
    test("returns defensive copies", async () => {
      const createResult = await manager.create(
        makeConfig({ label: "List Me" }),
      );
      expect(createResult.isOk()).toBe(true);
      if (!createResult.isOk()) return;

      const listResult = await manager.list();
      expect(listResult.isOk()).toBe(true);
      if (!listResult.isOk()) return;

      listResult.value[0]!.config.label = "Mutated";

      const secondList = await manager.list();
      expect(secondList.isOk()).toBe(true);
      if (!secondList.isOk()) return;
      expect(secondList.value[0]?.config.label).toBe("List Me");
    });
  });
});
