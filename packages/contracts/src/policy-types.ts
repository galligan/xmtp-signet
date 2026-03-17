import type {
  ContentTypeId,
  GrantDeniedError,
  PermissionError,
} from "@xmtp/signet-schemas";

/** Describes a change between two policy configurations. */
export interface PolicyDelta {
  readonly viewChanges: ReadonlyArray<{
    field: string;
    from: unknown;
    to: unknown;
  }>;
  readonly grantChanges: ReadonlyArray<{
    field: string;
    from: unknown;
    to: unknown;
  }>;
  readonly contentTypeChanges: {
    readonly added: readonly ContentTypeId[];
    readonly removed: readonly ContentTypeId[];
  };
}

/** Type alias for grant enforcement error results. */
export type GrantError = GrantDeniedError | PermissionError;
