import { describe, expect, it } from "bun:test";
import {
  createResourceId,
  parseResourceId,
  resolveShortId,
  OperatorId,
  InboxId,
  ConversationId,
  CredentialId,
  AnyResourceId,
  RESOURCE_PREFIXES,
  RESOURCE_ID_HEX_LENGTH,
} from "../resource-id.js";
import type { ResourceType } from "../resource-id.js";

const EXPECTED_PREFIXES: Record<ResourceType, string> = {
  operator: "op_",
  inbox: "inbox_",
  conversation: "conv_",
  policy: "policy_",
  credential: "cred_",
  seal: "seal_",
  key: "key_",
  message: "msg_",
  network: "xmtp_",
};

describe("createResourceId", () => {
  for (const [type, prefix] of Object.entries(EXPECTED_PREFIXES)) {
    it(`generates an ID starting with "${prefix}" for type "${type}"`, () => {
      const id = createResourceId(type as ResourceType);
      expect(id.startsWith(prefix)).toBe(true);
    });
  }

  it("produces a 16-character hex suffix", () => {
    const id = createResourceId("operator");
    const hex = id.slice("op_".length);
    expect(hex).toHaveLength(RESOURCE_ID_HEX_LENGTH);
    expect(new RegExp(`^[0-9a-f]{${RESOURCE_ID_HEX_LENGTH}}$`).test(hex)).toBe(
      true,
    );
  });

  it("produces different IDs on successive calls", () => {
    const a = createResourceId("seal");
    const b = createResourceId("seal");
    expect(a).not.toBe(b);
  });
});

describe("parseResourceId", () => {
  for (const [type, prefix] of Object.entries(EXPECTED_PREFIXES)) {
    it(`parses "${prefix}aabbccddeeff0011" as type "${type}"`, () => {
      const id = `${prefix}aabbccddeeff0011`;
      const parsed = parseResourceId(id);
      expect(parsed.type).toBe(type);
      expect(parsed.prefix).toBe(prefix);
      expect(parsed.shortId).toBe("aabbccddeeff0011");
      expect(parsed.fullId).toBe(id);
    });
  }

  it("throws ValidationError for unrecognized prefix", () => {
    expect(() => parseResourceId("bad_1234567890abcdef")).toThrow(
      /Unrecognized resource ID prefix/,
    );
  });

  it("throws ValidationError for empty string", () => {
    expect(() => parseResourceId("")).toThrow(
      /Unrecognized resource ID prefix/,
    );
  });

  it("throws ValidationError for missing hex suffix", () => {
    expect(() => parseResourceId("op_")).toThrow(
      /must end with 16 lowercase hex characters/,
    );
  });

  it("throws ValidationError for non-hex suffix", () => {
    expect(() => parseResourceId("op_nothex")).toThrow(
      /must end with 16 lowercase hex characters/,
    );
  });
});

describe("per-prefix Zod schemas", () => {
  it("OperatorId accepts op_ prefix", () => {
    expect(OperatorId.safeParse("op_1234567890abcdef").success).toBe(true);
  });

  it("OperatorId rejects missing hex suffix", () => {
    expect(OperatorId.safeParse("op_").success).toBe(false);
  });

  it("CredentialId rejects non-hex suffix", () => {
    expect(CredentialId.safeParse("cred_nothex").success).toBe(false);
  });

  it("OperatorId rejects wrong prefix", () => {
    expect(
      OperatorId.safeParse("inbox_1234567890abcdef").success,
    ).toBe(false);
  });

  it("InboxId accepts inbox_ prefix", () => {
    expect(InboxId.safeParse("inbox_abcdef0012345678").success).toBe(true);
  });

  it("InboxId rejects wrong prefix", () => {
    expect(InboxId.safeParse("op_abcdef0012345678").success).toBe(false);
  });

  it("ConversationId accepts conv_ prefix", () => {
    expect(ConversationId.safeParse("conv_1122334455667788").success).toBe(
      true,
    );
  });

  it("ConversationId rejects wrong prefix", () => {
    expect(ConversationId.safeParse("seal_1122334455667788").success).toBe(
      false,
    );
  });

  it("CredentialId accepts cred_ prefix", () => {
    expect(CredentialId.safeParse("cred_deadbeefcafefeed").success).toBe(true);
  });

  it("CredentialId rejects wrong prefix", () => {
    expect(CredentialId.safeParse("key_deadbeefcafefeed").success).toBe(false);
  });

  it("AnyResourceId accepts all valid prefixes", () => {
    for (const prefix of Object.values(RESOURCE_PREFIXES)) {
      const id = `${prefix}aabbccddeeff0011`;
      expect(AnyResourceId.safeParse(id).success).toBe(true);
    }
  });

  it("AnyResourceId rejects unknown prefix", () => {
    expect(
      AnyResourceId.safeParse("unknown_aabbccddeeff0011").success,
    ).toBe(false);
  });
});

describe("resolveShortId", () => {
  const candidates = [
    "op_aabb001122334455",
    "op_aabb002233445566",
    "conv_ccdd003344556677",
    "seal_eeff445566778899",
  ];

  it("returns Ok with exact match for unique prefix", () => {
    const result = resolveShortId("ccdd", candidates);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("conv_ccdd003344556677");
    }
  });

  it("returns Err with suggestions when multiple candidates match", () => {
    const result = resolveShortId("aabb", candidates);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("validation");
    }
  });

  it("returns Err(NotFoundError) when no candidate matches", () => {
    const result = resolveShortId("ffff", candidates);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("not_found");
    }
  });

  it("returns an exact match when given a full resource ID", () => {
    const result = resolveShortId("conv_ccdd003344556677", candidates);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("conv_ccdd003344556677");
    }
  });

  it("uses a prefixed short ID to disambiguate candidates", () => {
    const result = resolveShortId("op_aabb002233445566", candidates);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("op_aabb002233445566");
    }
  });

  it("rejects prefixed short IDs with no hex suffix", () => {
    const result = resolveShortId("op_", candidates);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("validation");
    }
  });

  it("rejects non-hex short IDs", () => {
    const result = resolveShortId("zzzz", candidates);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("validation");
    }
  });

  it("returns Err(NotFoundError) for empty candidates array", () => {
    const result = resolveShortId("aabb", []);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.category).toBe("not_found");
    }
  });
});
