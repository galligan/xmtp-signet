import type {
  CredentialRecordType,
  CredentialStatusType,
  ScopeSetType,
} from "@xmtp/signet-schemas";

/** Runtime-enriched credential record with computed fields. */
export interface CredentialRecord extends CredentialRecordType {
  readonly credentialId: string;
  readonly operatorId: string;
  readonly effectiveScopes: ScopeSetType;
  readonly status: CredentialStatusType;
  readonly isExpired: boolean;
  readonly lastHeartbeat: string;
}

/** Result of checking whether a scope change is material. */
export interface MaterialityCheck {
  readonly isMaterial: boolean;
  readonly reason: string | null;
  /** Whether the change expands privilege and therefore requires reauthorization. */
  readonly requiresReauthorization: boolean;
}
