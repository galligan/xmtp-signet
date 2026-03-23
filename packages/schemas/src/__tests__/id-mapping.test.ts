import { describe, expect, it } from "bun:test";
import {
  IdMappingResourceType,
  IdMapping,
  type IdMappingResourceTypeType,
  type IdMappingType,
  type IdMappingStore,
} from "../id-mapping.js";

describe("IdMappingResourceType", () => {
  it("accepts valid resource types", () => {
    expect(IdMappingResourceType.safeParse("message").success).toBe(true);
    expect(IdMappingResourceType.safeParse("conversation").success).toBe(true);
    expect(IdMappingResourceType.safeParse("inbox").success).toBe(true);
  });

  it("rejects invalid resource types", () => {
    expect(IdMappingResourceType.safeParse("seal").success).toBe(false);
    expect(IdMappingResourceType.safeParse("operator").success).toBe(false);
    expect(IdMappingResourceType.safeParse("").success).toBe(false);
    expect(IdMappingResourceType.safeParse(42).success).toBe(false);
  });

  it("exposes enum values", () => {
    const values = IdMappingResourceType.options;
    expect(values).toEqual(["message", "conversation", "inbox"]);
  });
});

describe("IdMapping", () => {
  const valid: IdMappingType = {
    networkId: "xmtp_abc12345feedbabe",
    localId: "msg_abc12345feedbabe",
    resourceType: "message",
    createdAt: "2024-01-01T00:00:00Z",
  };

  it("accepts a valid id mapping", () => {
    expect(IdMapping.safeParse(valid).success).toBe(true);
  });

  it("accepts conversation mapping", () => {
    const convMapping = {
      ...valid,
      localId: "conv_abc12345feedbabe",
      resourceType: "conversation",
    };
    expect(IdMapping.safeParse(convMapping).success).toBe(true);
  });

  it("accepts inbox mapping", () => {
    const inboxMapping = {
      ...valid,
      localId: "inbox_abc12345feedbabe",
      resourceType: "inbox",
    };
    expect(IdMapping.safeParse(inboxMapping).success).toBe(true);
  });

  it("rejects non-network networkId", () => {
    expect(
      IdMapping.safeParse({ ...valid, networkId: "msg_abc12345feedbabe" }).success,
    ).toBe(false);
  });

  it("rejects invalid localId prefix", () => {
    expect(IdMapping.safeParse({ ...valid, localId: "bad_id" }).success).toBe(
      false,
    );
  });

  it("rejects invalid resourceType", () => {
    expect(
      IdMapping.safeParse({ ...valid, resourceType: "seal" }).success,
    ).toBe(false);
  });

  it("rejects a local message mapping with a non-message local ID", () => {
    expect(
      IdMapping.safeParse({
        ...valid,
        localId: "cred_abc12345feedbabe",
        resourceType: "message",
      }).success,
    ).toBe(false);
  });

  it("rejects a local mapping that points at another network ID", () => {
    expect(
      IdMapping.safeParse({
        ...valid,
        localId: "xmtp_def67890feedbabe",
        resourceType: "message",
      }).success,
    ).toBe(false);
  });

  it("rejects non-datetime createdAt", () => {
    expect(
      IdMapping.safeParse({ ...valid, createdAt: "not-a-date" }).success,
    ).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(IdMapping.safeParse({}).success).toBe(false);
    expect(IdMapping.safeParse({ networkId: "xmtp_abc12345feedbabe" }).success).toBe(
      false,
    );
  });
});

describe("IdMappingStore interface", () => {
  it("is structurally compatible with a conforming implementation", () => {
    const store: IdMappingStore = {
      set(
        _networkId: string,
        _localId: string,
        _resourceType: IdMappingResourceTypeType,
      ): void {},
      getLocal(_networkId: string): string | null {
        return null;
      },
      getNetwork(_localId: string): string | null {
        return null;
      },
      resolve(_id: string): { networkId: string; localId: string } | null {
        return null;
      },
    };
    expect(store).toBeDefined();
  });
});
