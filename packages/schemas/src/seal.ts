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
import {
  ProvenanceMap,
  OPERATOR_DISCLOSURE_PROVENANCE_KEYS,
} from "./claim-provenance.js";
import type { ProvenanceMapType } from "./claim-provenance.js";

// -- Types (declared first for isolatedDeclarations) -----------------------

/**
 * Operator-declared claims about the runtime environment.
 *
 * These are self-reported by the operator and passed through by the signet
 * without independent confirmation. Consuming interfaces should render
 * these with appropriate trust caveats unless the provenanceMap indicates
 * they have been upgraded to `observed` or `verified`.
 */
export type OperatorDisclosuresType = {
  /** How inference is performed: locally, via cloud providers, or a mix. */
  inferenceMode?: "local" | "cloud" | "hybrid" | undefined;
  /** Which inference providers content may be sent to. */
  inferenceProviders?: string[] | undefined;
  /** What data is permitted to leave the signet boundary. */
  contentEgressScope?: "none" | "provider-only" | "unrestricted" | undefined;
  /** Provider's stated data retention policy. */
  retentionAtProvider?: string | undefined;
  /** Where the agent runtime is hosted. */
  hostingMode?: "self-hosted" | "cloud" | "tee" | undefined;
};

/** Trust tier surfaced on a seal when the signet has external verification evidence. */
export type TrustTierType =
  | "unverified"
  | "source-verified"
  | "reproducibly-verified"
  | "runtime-attested";

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
  /** True when the seal used synthetic fallback input via SIGNET_SEAL_BYPASS. */
  bypassed?: true | undefined;
  /** Signet-managed trust tier for this operator/runtime. */
  trustTier?: TrustTierType | undefined;
  /** Operator-declared claims about the runtime environment. */
  operatorDisclosures?: OperatorDisclosuresType | undefined;
  /** Provenance metadata for disclosed and externally-verified claims. */
  provenanceMap?: ProvenanceMapType | undefined;
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

/** Inference execution mode. */
export const InferenceMode: z.ZodEnum<["local", "cloud", "hybrid"]> = z.enum([
  "local",
  "cloud",
  "hybrid",
]);

/** Content egress scope. */
export const ContentEgressScope: z.ZodEnum<
  ["none", "provider-only", "unrestricted"]
> = z.enum(["none", "provider-only", "unrestricted"]);

/** Agent runtime hosting mode. */
export const HostingMode: z.ZodEnum<["self-hosted", "cloud", "tee"]> = z.enum([
  "self-hosted",
  "cloud",
  "tee",
]);

/** Trust tier surfaced on a seal when available. */
export const TrustTier: z.ZodEnum<
  ["unverified", "source-verified", "reproducibly-verified", "runtime-attested"]
> = z.enum([
  "unverified",
  "source-verified",
  "reproducibly-verified",
  "runtime-attested",
]);

type OperatorDisclosureClaimKey =
  (typeof OPERATOR_DISCLOSURE_PROVENANCE_KEYS)[number];

/**
 * Operator-declared claims about the runtime environment.
 * All fields are optional — operators disclose what they choose to.
 */
export const OperatorDisclosures: z.ZodType<OperatorDisclosuresType> = z
  .object({
    /** How inference is performed. */
    inferenceMode: InferenceMode.optional(),
    /** Which inference providers content may be sent to. */
    inferenceProviders: z.array(z.string()).optional(),
    /** What data is permitted to leave the signet boundary. */
    contentEgressScope: ContentEgressScope.optional(),
    /** Provider's stated data retention policy. */
    retentionAtProvider: z.string().optional(),
    /** Where the agent runtime is hosted. */
    hostingMode: HostingMode.optional(),
  })
  .describe("Operator-declared claims about the runtime environment");

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
    /** Present only when seal input resolution was bypassed. */
    bypassed: z.literal(true).optional(),
    /** Signet-managed trust tier for this operator/runtime. */
    trustTier: TrustTier.optional(),
    /** Operator-declared claims about the runtime environment. */
    operatorDisclosures: OperatorDisclosures.optional(),
    /**
     * Provenance metadata for disclosed and externally-verified claims.
     * Derived fields (sealId, permissions, etc.) have no entries —
     * their provenance is structural. Only operatorDisclosures fields
     * and the externally-verified trustTier claim
     * get entries.
     */
    provenanceMap: ProvenanceMap.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.provenanceMap === undefined) return;

    for (const key of OPERATOR_DISCLOSURE_PROVENANCE_KEYS) {
      const disclosureKey = key as OperatorDisclosureClaimKey;
      if (
        value.provenanceMap[disclosureKey] !== undefined &&
        value.operatorDisclosures?.[disclosureKey] === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provenanceMap", disclosureKey],
          message: `Provenance for ${disclosureKey} requires a corresponding operator disclosure`,
        });
      }
    }

    if (
      value.provenanceMap.trustTier !== undefined &&
      value.trustTier === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provenanceMap", "trustTier"],
        message:
          "Provenance for trustTier requires a corresponding trustTier value",
      });
    }
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
