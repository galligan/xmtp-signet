import type {
  CredentialConfigType,
  CredentialRecordType,
  CredentialTokenType,
  IssuedCredentialType,
} from "../credential.js";
import type {
  MessageSealBindingType,
  SealEnvelopeType,
  SealPayloadType,
} from "../seal.js";

/** Valid credential config fixture. */
export function createTestCredentialConfig(
  overrides: Partial<CredentialConfigType> = {},
): CredentialConfigType {
  return {
    operatorId: "op_12345678feedbabe",
    chatIds: ["conv_12345678feedbabe"],
    allow: ["send", "reply"],
    deny: [],
    ttlSeconds: 3600,
    ...overrides,
  };
}

/** Valid persisted credential record fixture. */
export function createTestCredentialRecord(
  overrides: Partial<CredentialRecordType> = {},
): CredentialRecordType {
  return {
    id: "cred_12345678feedbabe",
    config: createTestCredentialConfig(),
    inboxIds: ["inbox_12345678feedbabe"],
    status: "active",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T01:00:00Z",
    issuedBy: "op_87654321feedbabe",
    ...overrides,
  };
}

/** Valid credential token fixture. */
export function createTestCredentialToken(
  overrides: Partial<CredentialTokenType> = {},
): CredentialTokenType {
  return {
    credentialId: "cred_12345678feedbabe",
    operatorId: "op_12345678feedbabe",
    fingerprint: "fp_test_credential",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2024-01-01T01:00:00Z",
    ...overrides,
  };
}

/** Valid issued credential fixture. */
export function createTestIssuedCredential(
  overrides: Partial<IssuedCredentialType> = {},
): IssuedCredentialType {
  return {
    token: "test-bearer-token",
    credential: createTestCredentialRecord(),
    ...overrides,
  };
}

/** Valid seal payload fixture. */
export function createTestSealPayload(
  overrides: Partial<SealPayloadType> = {},
): SealPayloadType {
  return {
    sealId: "seal_12345678feedbabe",
    credentialId: "cred_12345678feedbabe",
    operatorId: "op_12345678feedbabe",
    chatId: "conv_12345678feedbabe",
    scopeMode: "per-chat",
    permissions: {
      allow: ["send", "reply"],
      deny: [],
    },
    issuedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Valid message-seal binding fixture. */
export function createTestMessageSealBinding(
  overrides: Partial<MessageSealBindingType> = {},
): MessageSealBindingType {
  return {
    sealRef: "seal_12345678feedbabe",
    sealSignature: "dGVzdC1zaWduYXR1cmU=",
    ...overrides,
  };
}

/** Valid seal envelope fixture. */
export function createTestSealEnvelope(
  overrides: Partial<SealEnvelopeType> = {},
): SealEnvelopeType {
  return {
    chain: {
      current: createTestSealPayload(),
      delta: { added: [], removed: [], changed: [] },
    },
    signature: "dGVzdC1zZWFsLXNpZw==",
    keyId: "key_12345678feedbabe",
    algorithm: "Ed25519",
    ...overrides,
  };
}
