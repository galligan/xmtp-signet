import protobuf from "protobufjs";
import type {
  ConvosContentTypeId,
  EncodedConvosContent,
} from "./join-request-content.js";

const root = new protobuf.Root();

const MemberKindEnum = new protobuf.Enum("MemberKind")
  .add("MEMBER_KIND_UNSPECIFIED", 0)
  .add("MEMBER_KIND_AGENT", 1);

const MetadataValueType = new protobuf.Type("MetadataValue")
  .add(
    new protobuf.OneOf("value", ["string_value", "number_value", "bool_value"]),
  )
  .add(new protobuf.Field("string_value", 1, "string", "optional"))
  .add(new protobuf.Field("number_value", 2, "double", "optional"))
  .add(new protobuf.Field("bool_value", 3, "bool", "optional"));

const EncryptedProfileImageRefType = new protobuf.Type(
  "EncryptedProfileImageRef",
)
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("salt", 2, "bytes"))
  .add(new protobuf.Field("nonce", 3, "bytes"));

const ProfileUpdateType = new protobuf.Type("ProfileUpdate")
  .add(new protobuf.Field("name", 1, "string", "optional"))
  .add(
    new protobuf.Field(
      "encrypted_image",
      2,
      "EncryptedProfileImageRef",
      "optional",
    ),
  )
  .add(new protobuf.Field("member_kind", 3, "MemberKind", "optional"))
  .add(new protobuf.MapField("metadata", 4, "string", "MetadataValue"));

const MemberProfileType = new protobuf.Type("MemberProfile")
  .add(new protobuf.Field("inbox_id", 1, "bytes"))
  .add(new protobuf.Field("name", 2, "string", "optional"))
  .add(
    new protobuf.Field(
      "encrypted_image",
      3,
      "EncryptedProfileImageRef",
      "optional",
    ),
  )
  .add(new protobuf.Field("member_kind", 4, "MemberKind", "optional"))
  .add(new protobuf.MapField("metadata", 5, "string", "MetadataValue"));

const ProfileSnapshotType = new protobuf.Type("ProfileSnapshot").add(
  new protobuf.Field("profiles", 1, "MemberProfile", "repeated"),
);

root.add(MemberKindEnum);
root.add(MetadataValueType);
root.add(EncryptedProfileImageRefType);
root.add(ProfileUpdateType);
root.add(MemberProfileType);
root.add(ProfileSnapshotType);

/** Content type descriptor for Convos profile updates. */
export const ContentTypeProfileUpdate: ConvosContentTypeId = {
  authorityId: "convos.org",
  typeId: "profile_update",
  versionMajor: 1,
  versionMinor: 0,
};

/** Content type descriptor for Convos profile snapshots. */
export const ContentTypeProfileSnapshot: ConvosContentTypeId = {
  authorityId: "convos.org",
  typeId: "profile_snapshot",
  versionMajor: 1,
  versionMinor: 0,
};

/** Member kinds currently surfaced by the Convos profile protocol. */
export enum MemberKind {
  Unspecified = 0,
  Agent = 1,
}

/** Reference to an encrypted profile image published through Convos metadata. */
export interface EncryptedProfileImageRef {
  readonly url: string;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
}

/** Supported metadata value variants for Convos profile payloads. */
export type ProfileMetadataValue =
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "bool"; readonly value: boolean };

/** Arbitrary key-value metadata attached to a Convos profile payload. */
export type ProfileMetadata = Record<string, ProfileMetadataValue>;

/** Structured payload for a member's latest Convos profile update. */
export interface ProfileUpdateContent {
  readonly name?: string;
  readonly encryptedImage?: EncryptedProfileImageRef;
  readonly memberKind?: MemberKind;
  readonly metadata?: ProfileMetadata;
}

/** Resolved profile fields for a single inbox inside a profile snapshot. */
export interface MemberProfileEntry {
  readonly inboxId: string;
  readonly name?: string;
  readonly encryptedImage?: EncryptedProfileImageRef;
  readonly memberKind?: MemberKind;
  readonly metadata?: ProfileMetadata;
}

/** Snapshot of the member profiles a host wants to publish for a conversation. */
export interface ProfileSnapshotContent {
  readonly profiles: readonly MemberProfileEntry[];
}

interface RawMetadataValue {
  readonly string_value?: string;
  readonly number_value?: number;
  readonly bool_value?: boolean;
  readonly value?: "string_value" | "number_value" | "bool_value";
}

function metadataToProto(
  metadata: ProfileMetadata,
): Record<string, RawMetadataValue> {
  const result: Record<string, RawMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    switch (value.type) {
      case "string":
        result[key] = { string_value: value.value };
        break;
      case "number":
        result[key] = { number_value: value.value };
        break;
      case "bool":
        result[key] = { bool_value: value.value };
        break;
    }
  }
  return result;
}

function metadataFromProto(
  raw: Record<string, RawMetadataValue> | undefined,
): ProfileMetadata | undefined {
  if (!raw || Object.keys(raw).length === 0) return undefined;

  const result: ProfileMetadata = {};
  for (const [key, value] of Object.entries(raw)) {
    switch (value.value) {
      case "string_value":
        result[key] = { type: "string", value: value.string_value ?? "" };
        break;
      case "number_value":
        result[key] = { type: "number", value: value.number_value ?? 0 };
        break;
      case "bool_value":
        result[key] = { type: "bool", value: value.bool_value ?? false };
        break;
      default:
        if (value.string_value !== undefined) {
          result[key] = { type: "string", value: value.string_value };
        } else if (value.number_value !== undefined) {
          result[key] = { type: "number", value: value.number_value };
        } else if (value.bool_value !== undefined) {
          result[key] = { type: "bool", value: value.bool_value };
        }
        break;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** Encodes a profile update into the XMTP custom-content envelope Convos expects. */
export function encodeProfileUpdate(
  update: ProfileUpdateContent,
): EncodedConvosContent {
  const raw: Record<string, unknown> = {};

  if (update.name !== undefined) {
    raw["name"] = update.name;
  }
  if (update.encryptedImage !== undefined) {
    raw["encrypted_image"] = {
      url: update.encryptedImage.url,
      salt: update.encryptedImage.salt,
      nonce: update.encryptedImage.nonce,
    };
  }
  if (
    update.memberKind !== undefined &&
    update.memberKind !== MemberKind.Unspecified
  ) {
    raw["member_kind"] = update.memberKind;
  }
  if (update.metadata && Object.keys(update.metadata).length > 0) {
    raw["metadata"] = metadataToProto(update.metadata);
  }

  const error = ProfileUpdateType.verify(raw);
  if (error) {
    throw new Error(`Invalid ProfileUpdate: ${error}`);
  }

  return {
    type: ContentTypeProfileUpdate,
    parameters: {},
    content: Buffer.from(
      ProfileUpdateType.encode(ProfileUpdateType.create(raw)).finish(),
    ),
  };
}

/** Decodes a profile update from the XMTP custom-content envelope. */
export function decodeProfileUpdate(
  encoded: Pick<EncodedConvosContent, "content">,
): ProfileUpdateContent {
  const decoded = ProfileUpdateType.decode(encoded.content);
  const object = ProfileUpdateType.toObject(decoded, {
    longs: Number,
    bytes: Uint8Array,
    defaults: false,
    arrays: true,
    objects: true,
  }) as Record<string, unknown>;

  const encryptedImage = object["encrypted_image"] as
    | {
        readonly url?: string;
        readonly salt?: Uint8Array;
        readonly nonce?: Uint8Array;
      }
    | undefined;
  const metadata = metadataFromProto(
    object["metadata"] as Record<string, RawMetadataValue> | undefined,
  );

  return {
    ...(typeof object["name"] === "string" ? { name: object["name"] } : {}),
    ...(encryptedImage
      ? {
          encryptedImage: {
            url: encryptedImage.url ?? "",
            salt: encryptedImage.salt ?? new Uint8Array(),
            nonce: encryptedImage.nonce ?? new Uint8Array(),
          },
        }
      : {}),
    ...(typeof object["member_kind"] === "number"
      ? { memberKind: object["member_kind"] as MemberKind }
      : {}),
    ...(metadata ? { metadata } : {}),
  };
}

/** Encodes a profile snapshot into the XMTP custom-content envelope. */
export function encodeProfileSnapshot(
  snapshot: ProfileSnapshotContent,
): EncodedConvosContent {
  const raw = {
    profiles: snapshot.profiles.map((profile) => {
      const entry: Record<string, unknown> = {
        inbox_id: hexToBytes(profile.inboxId),
      };

      if (profile.name !== undefined) {
        entry["name"] = profile.name;
      }
      if (profile.encryptedImage !== undefined) {
        entry["encrypted_image"] = {
          url: profile.encryptedImage.url,
          salt: profile.encryptedImage.salt,
          nonce: profile.encryptedImage.nonce,
        };
      }
      if (
        profile.memberKind !== undefined &&
        profile.memberKind !== MemberKind.Unspecified
      ) {
        entry["member_kind"] = profile.memberKind;
      }
      if (profile.metadata && Object.keys(profile.metadata).length > 0) {
        entry["metadata"] = metadataToProto(profile.metadata);
      }

      return entry;
    }),
  };

  const error = ProfileSnapshotType.verify(raw);
  if (error) {
    throw new Error(`Invalid ProfileSnapshot: ${error}`);
  }

  return {
    type: ContentTypeProfileSnapshot,
    parameters: {},
    content: Buffer.from(
      ProfileSnapshotType.encode(ProfileSnapshotType.create(raw)).finish(),
    ),
  };
}

/** Decodes a profile snapshot from the XMTP custom-content envelope. */
export function decodeProfileSnapshot(
  encoded: Pick<EncodedConvosContent, "content">,
): ProfileSnapshotContent {
  const decoded = ProfileSnapshotType.decode(encoded.content);
  const object = ProfileSnapshotType.toObject(decoded, {
    longs: Number,
    bytes: Uint8Array,
    defaults: false,
    arrays: true,
    objects: true,
  }) as {
    profiles?: ReadonlyArray<Record<string, unknown>>;
  };

  return {
    profiles: (object.profiles ?? []).map((profile) => {
      const encryptedImage = profile["encrypted_image"] as
        | {
            readonly url?: string;
            readonly salt?: Uint8Array;
            readonly nonce?: Uint8Array;
          }
        | undefined;
      const metadata = metadataFromProto(
        profile["metadata"] as Record<string, RawMetadataValue> | undefined,
      );

      return {
        inboxId: bytesToHex(
          (profile["inbox_id"] as Uint8Array) ?? new Uint8Array(),
        ),
        ...(typeof profile["name"] === "string"
          ? { name: profile["name"] as string }
          : {}),
        ...(encryptedImage
          ? {
              encryptedImage: {
                url: encryptedImage.url ?? "",
                salt: encryptedImage.salt ?? new Uint8Array(),
                nonce: encryptedImage.nonce ?? new Uint8Array(),
              },
            }
          : {}),
        ...(typeof profile["member_kind"] === "number"
          ? { memberKind: profile["member_kind"] as MemberKind }
          : {}),
        ...(metadata ? { metadata } : {}),
      };
    }),
  };
}

/** Codec that round-trips Convos profile updates through XMTP custom content. */
export class ProfileUpdateCodec {
  get contentType(): ConvosContentTypeId {
    return ContentTypeProfileUpdate;
  }

  encode(content: ProfileUpdateContent): EncodedConvosContent {
    return encodeProfileUpdate(content);
  }

  decode(content: EncodedConvosContent): ProfileUpdateContent {
    return decodeProfileUpdate(content);
  }

  fallback(): undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}

/** Codec that round-trips Convos profile snapshots through XMTP custom content. */
export class ProfileSnapshotCodec {
  get contentType(): ConvosContentTypeId {
    return ContentTypeProfileSnapshot;
  }

  encode(content: ProfileSnapshotContent): EncodedConvosContent {
    return encodeProfileSnapshot(content);
  }

  decode(content: EncodedConvosContent): ProfileSnapshotContent {
    return decodeProfileSnapshot(content);
  }

  fallback(): undefined {
    return undefined;
  }

  shouldPush(): boolean {
    return false;
  }
}
