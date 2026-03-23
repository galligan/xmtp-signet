import { z } from "zod";
import {
  SealId,
  CredentialId,
  OperatorId,
  ConversationId,
  KeyId,
} from "./resource-id.js";
import { ScopeMode } from "./operator.js";
import { ScopeSet, PermissionScope } from "./permission-scopes.js";
import type { PermissionScopeType, ScopeSetType } from "./permission-scopes.js";
import type { ScopeModeType } from "./operator.js";

// -- Types (declared first for isolatedDeclarations) -----------------------

/** Core payload of a capability seal. */
export type SealPayloadType = {
  sealId: string;
  credentialId: string;
  operatorId: string;
  chatId: string;
  scopeMode: ScopeModeType;
  permissions: ScopeSetType;
  adminAccess?: { operatorId: string; expiresAt: string } | undefined;
  issuedAt: string;
};

/** Convenience diff between current and previous seal payloads. */
export type SealDeltaType = {
  added: PermissionScopeType[];
  removed: PermissionScopeType[];
  changed: {
    scope: PermissionScopeType;
    from: "allow" | "deny";
    to: "allow" | "deny";
  }[];
};

/** Seal chain linking current to predecessor. */
export type SealChainType = {
  current: SealPayloadType;
  previous?: SealPayloadType | undefined;
  delta: SealDeltaType;
};

/** Binding between a message and a seal. */
export type MessageSealBindingType = {
  sealRef: string;
  sealSignature: string;
};

/** Verification status of a seal. */
export type SealVerificationStatusType =
  | "valid"
  | "superseded"
  | "revoked"
  | "missing";

/** Signed envelope wrapping a seal chain. */
export type SealEnvelopeType = {
  chain: SealChainType;
  signature: string;
  keyId: string;
  algorithm: "Ed25519";
};

// -- Schemas ---------------------------------------------------------------

/**
 * Core payload of a capability seal, binding an operator credential
 * to a conversation with resolved permission scopes.
 */
export const SealPayload: z.ZodType<SealPayloadType> = z
  .object({
    /** Unique seal identifier. */
    sealId: SealId,
    /** Credential this seal was issued under. */
    credentialId: CredentialId,
    /** Operator this seal belongs to. */
    operatorId: OperatorId,
    /** Conversation this seal applies to. */
    chatId: ConversationId,
    /** Whether scopes are per-chat or shared across conversations. */
    scopeMode: ScopeMode,
    /** Effective allowed/denied permission scopes. */
    permissions: ScopeSet,
    /** Disclosed admin read access, if any. */
    adminAccess: z
      .object({
        /** Admin operator who has read access. */
        operatorId: OperatorId,
        /** When the admin access expires. */
        expiresAt: z.string().datetime(),
      })
      .optional(),
    /** When this seal was issued. */
    issuedAt: z.string().datetime(),
  })
  .describe("Core payload of a capability seal");

/**
 * Convenience diff between a current and previous seal payload,
 * showing which scopes were added, removed, or changed.
 */
export const SealDelta: z.ZodType<SealDeltaType> = z
  .object({
    /** Scopes newly allowed in the current seal. */
    added: z.array(PermissionScope),
    /** Scopes removed or newly denied in the current seal. */
    removed: z.array(PermissionScope),
    /** Scopes whose allow/deny status changed. */
    changed: z.array(
      z.object({
        /** The scope that changed. */
        scope: PermissionScope,
        /** Previous state. */
        from: z.enum(["allow", "deny"]),
        /** New state. */
        to: z.enum(["allow", "deny"]),
      }),
    ),
  })
  .describe("Diff between current and previous seal payloads");

/**
 * A seal chain linking the current seal payload to its predecessor.
 * The first seal in a chain has no `previous`.
 */
export const SealChain: z.ZodType<SealChainType> = z
  .object({
    /** The current seal payload. */
    current: SealPayload,
    /** Full inline previous payload. Absent for the first seal. */
    previous: SealPayload.optional(),
    /** Convenience diff between current and previous. */
    delta: SealDelta,
  })
  .describe("Seal chain with current, previous, and delta");

/**
 * Binds a message to a seal via a cryptographic signature
 * over the message ID and seal ID.
 */
export const MessageSealBinding: z.ZodType<MessageSealBindingType> = z
  .object({
    /** Reference to the seal this message is bound to. */
    sealRef: SealId,
    /** Signature over messageId + sealId. */
    sealSignature: z.string(),
  })
  .describe("Binding between a message and a seal");

/** Verification status of a seal. */
export const SealVerificationStatus: z.ZodEnum<
  ["valid", "superseded", "revoked", "missing"]
> = z.enum(["valid", "superseded", "revoked", "missing"]);

/**
 * Signed envelope wrapping a seal chain with a cryptographic
 * signature for integrity verification.
 */
export const SealEnvelope: z.ZodType<SealEnvelopeType> = z
  .object({
    /** The seal chain. */
    chain: SealChain,
    /** Cryptographic signature over the chain. */
    signature: z.string(),
    /** Key used to produce the signature. */
    keyId: KeyId,
    /** Signature algorithm. */
    algorithm: z.literal("Ed25519"),
  })
  .describe("Signed seal envelope for integrity verification");
