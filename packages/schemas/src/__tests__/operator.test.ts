import { describe, expect, it } from "bun:test";
import {
  OperatorRole,
  ScopeMode,
  OperatorStatus,
  WalletProvider,
  OperatorConfig,
  OperatorRecord,
} from "../operator.js";

// -- OperatorRole -----------------------------------------------------------

describe("OperatorRole", () => {
  it("accepts valid roles", () => {
    for (const role of ["operator", "admin", "superadmin"]) {
      expect(OperatorRole.safeParse(role).success).toBe(true);
    }
  });

  it("rejects invalid role", () => {
    expect(OperatorRole.safeParse("viewer").success).toBe(false);
  });
});

// -- ScopeMode --------------------------------------------------------------

describe("ScopeMode", () => {
  it("accepts valid scope modes", () => {
    for (const mode of ["per-chat", "shared"]) {
      expect(ScopeMode.safeParse(mode).success).toBe(true);
    }
  });

  it("rejects invalid scope mode", () => {
    expect(ScopeMode.safeParse("global").success).toBe(false);
  });
});

// -- OperatorStatus ---------------------------------------------------------

describe("OperatorStatus", () => {
  it("accepts valid statuses", () => {
    for (const status of ["active", "suspended", "removed"]) {
      expect(OperatorStatus.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid status", () => {
    expect(OperatorStatus.safeParse("pending").success).toBe(false);
  });
});

// -- WalletProvider ---------------------------------------------------------

describe("WalletProvider", () => {
  it("accepts valid providers", () => {
    for (const provider of ["internal", "ows"]) {
      expect(WalletProvider.safeParse(provider).success).toBe(true);
    }
  });

  it("rejects invalid provider", () => {
    expect(WalletProvider.safeParse("metamask").success).toBe(false);
  });
});

// -- OperatorConfig ---------------------------------------------------------

const validConfig = {
  label: "My Operator",
  role: "operator" as const,
  scopeMode: "per-chat" as const,
};

describe("OperatorConfig", () => {
  it("accepts minimal valid config", () => {
    const result = OperatorConfig.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("accepts config with optional provider and walletId", () => {
    const result = OperatorConfig.safeParse({
      ...validConfig,
      provider: "ows",
      walletId: "wallet-abc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("ows");
      expect(result.data.walletId).toBe("wallet-abc");
    }
  });

  it("defaults provider to internal when omitted", () => {
    const result = OperatorConfig.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("internal");
    }
  });

  it("rejects empty label", () => {
    const result = OperatorConfig.safeParse({
      ...validConfig,
      label: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role in config", () => {
    const result = OperatorConfig.safeParse({
      ...validConfig,
      role: "viewer",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid scopeMode in config", () => {
    const result = OperatorConfig.safeParse({
      ...validConfig,
      scopeMode: "global",
    });
    expect(result.success).toBe(false);
  });
});

// -- OperatorRecord ---------------------------------------------------------

const validRecord = {
  id: "op_abcd1234feedbabe",
  config: validConfig,
  createdAt: "2024-01-01T00:00:00Z",
  createdBy: "owner" as const,
  status: "active" as const,
};

describe("OperatorRecord", () => {
  it("accepts valid record created by owner", () => {
    const result = OperatorRecord.safeParse(validRecord);
    expect(result.success).toBe(true);
  });

  it("accepts record created by another operator", () => {
    const result = OperatorRecord.safeParse({
      ...validRecord,
      createdBy: "op_beef5678feedbabe",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid operator id prefix", () => {
    const result = OperatorRecord.safeParse({
      ...validRecord,
      id: "user_abcd1234",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid createdBy value", () => {
    const result = OperatorRecord.safeParse({
      ...validRecord,
      createdBy: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime for createdAt", () => {
    const result = OperatorRecord.safeParse({
      ...validRecord,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = OperatorRecord.safeParse({
      ...validRecord,
      status: "pending",
    });
    expect(result.success).toBe(false);
  });
});
