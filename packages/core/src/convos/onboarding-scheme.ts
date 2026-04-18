import { Result } from "better-result";
import { ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type {
  CreatorContext,
  EncodedOnboardingContent,
  IncomingJoinRequestMessage,
  InviteMetadata,
  InviteOptions,
  MemberProfileData,
  OnboardingContentTypeId,
  OnboardingScheme,
  ParsedInvite,
  ProcessedJoinRequest,
  ProfileData,
  ResolvedOnboardingProfile,
} from "../schemes/onboarding-scheme.js";
import { createConvosCodecs } from "./codecs.js";
import {
  generateConvosInviteSlug,
  type GenerateInviteSlugOptions,
} from "./invite-generator.js";
import { ContentTypeInviteJoinError } from "./invite-join-error.js";
import {
  ContentTypeJoinRequest,
  isEncodedConvosContent,
  isJoinRequestContentType,
} from "./join-request-content.js";
import { parseConvosInviteUrl, verifyConvosInvite } from "./invite-parser.js";
import {
  ContentTypeProfileSnapshot,
  ContentTypeProfileUpdate,
  encodeProfileSnapshot,
  encodeProfileUpdate,
  MemberKind,
  type MemberProfileEntry,
  type ProfileMetadata,
  type ProfileMetadataValue,
  type ProfileSnapshotContent,
  type ProfileUpdateContent,
} from "./profile-messages.js";
import { resolveProfilesFromMessages } from "./profile-state.js";
import { processJoinRequest } from "./process-join-requests.js";

function formatContentType(contentType: OnboardingContentTypeId): string {
  return `${contentType.authorityId}/${contentType.typeId}:${contentType.versionMajor}.${contentType.versionMinor}`;
}

function resolveInviteBaseUrl(env: InviteOptions["env"]): string {
  return env === "dev" || env === "local"
    ? "https://dev.convos.org/v2"
    : "https://popup.convos.org/v2";
}

function toGenerateInviteSlugOptions(
  conversationId: string,
  conversationFormat: "uuid" | "string" | undefined,
  creator: CreatorContext,
  metadata: InviteMetadata,
  options: InviteOptions,
): GenerateInviteSlugOptions {
  return {
    conversationId,
    ...(conversationFormat !== undefined
      ? { conversationIdFormat: conversationFormat }
      : {}),
    creatorInboxId: creator.creatorInboxId,
    walletPrivateKeyHex: creator.walletPrivateKeyHex,
    inviteTag: metadata.tag,
    ...(metadata.name !== undefined ? { name: metadata.name } : {}),
    ...(metadata.description !== undefined
      ? { description: metadata.description }
      : {}),
    ...(metadata.imageUrl !== undefined ? { imageUrl: metadata.imageUrl } : {}),
    ...(options.expiresAt !== undefined
      ? { expiresAt: options.expiresAt }
      : {}),
    ...(options.expiresAfterUse !== undefined
      ? { expiresAfterUse: options.expiresAfterUse }
      : {}),
  };
}

function toConvosProfileMetadata(
  metadata: ProfileData["metadata"],
): ProfileMetadata | undefined {
  if (!metadata) return undefined;

  const converted: ProfileMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    const entry: ProfileMetadataValue =
      typeof value === "string"
        ? { type: "string", value }
        : typeof value === "number"
          ? { type: "number", value }
          : { type: "bool", value };
    converted[key] = entry;
  }

  return Object.keys(converted).length > 0 ? converted : undefined;
}

function fromConvosProfileMetadata(
  metadata: ProfileMetadata | undefined,
): ProfileData["metadata"] | undefined {
  if (!metadata) return undefined;

  const converted: ProfileData["metadata"] = {};
  for (const [key, value] of Object.entries(metadata)) {
    converted[key] = value.value;
  }

  return Object.keys(converted).length > 0 ? converted : undefined;
}

function toConvosMemberKind(
  memberKind: ProfileData["memberKind"],
): MemberKind | undefined {
  switch (memberKind) {
    case "agent":
      return MemberKind.Agent;
    case "human":
    case undefined:
    default:
      return undefined;
  }
}

function fromConvosMemberKind(
  memberKind: MemberKind | undefined,
): ProfileData["memberKind"] | undefined {
  if (memberKind === MemberKind.Agent) {
    return "agent";
  }
  return undefined;
}

function assertNoPlainProfileImageUrl(
  profile: Pick<ProfileData, "imageUrl">,
): void {
  if (profile.imageUrl !== undefined) {
    throw ValidationError.create(
      "imageUrl",
      "Convos profile messages require encrypted image metadata; raw image URLs are not supported",
    );
  }
}

function toProfileUpdateContent(profile: ProfileData): ProfileUpdateContent {
  assertNoPlainProfileImageUrl(profile);
  const memberKind = toConvosMemberKind(profile.memberKind);
  const metadata = toConvosProfileMetadata(profile.metadata);

  return {
    ...(profile.name !== undefined ? { name: profile.name } : {}),
    ...(memberKind !== undefined ? { memberKind } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function toMemberProfileEntry(profile: MemberProfileData): MemberProfileEntry {
  assertNoPlainProfileImageUrl(profile);
  const memberKind = toConvosMemberKind(profile.memberKind);
  const metadata = toConvosProfileMetadata(profile.metadata);

  return {
    inboxId: profile.inboxId,
    ...(profile.name !== undefined ? { name: profile.name } : {}),
    ...(memberKind !== undefined ? { memberKind } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function toParsedInvite(invite: ReturnType<typeof parseConvosInviteUrl>) {
  if (invite.isErr()) return invite;
  return Result.ok<ParsedInvite, SignetError>({
    schemeId: "convos",
    signedPayloadBytes: invite.value.signedInvitePayloadBytes,
    signatureBytes: invite.value.signedInviteSignature,
    conversationToken: invite.value.conversationToken,
    creatorInboxId: invite.value.creatorInboxId,
    tag: invite.value.tag,
    ...(invite.value.name !== undefined ? { name: invite.value.name } : {}),
    ...(invite.value.description !== undefined
      ? { description: invite.value.description }
      : {}),
    ...(invite.value.imageUrl !== undefined
      ? { imageUrl: invite.value.imageUrl }
      : {}),
    isExpired: invite.value.isExpired,
    isConversationExpired: invite.value.isConversationExpired,
    expiresAfterUse: invite.value.expiresAfterUse,
  });
}

function toConvosParsedInvite(
  invite: ParsedInvite,
): Result<Parameters<typeof verifyConvosInvite>[0], SignetError> {
  if (invite.schemeId !== "convos") {
    return Result.err(
      ValidationError.create(
        "inviteScheme",
        `Expected convos invite, received ${invite.schemeId}`,
      ),
    );
  }

  return Result.ok({
    signedInvitePayloadBytes: invite.signedPayloadBytes,
    signedInviteSignature: invite.signatureBytes,
    conversationToken: invite.conversationToken,
    creatorInboxId: invite.creatorInboxId,
    tag: invite.tag,
    name: invite.name,
    description: invite.description,
    imageUrl: invite.imageUrl,
    isExpired: invite.isExpired,
    isConversationExpired: invite.isConversationExpired,
    expiresAfterUse: invite.expiresAfterUse,
  });
}

function toResolvedProfile(
  profile: MemberProfileEntry,
): ResolvedOnboardingProfile {
  const memberKind = fromConvosMemberKind(profile.memberKind);
  const metadata = fromConvosProfileMetadata(profile.metadata);

  return {
    inboxId: profile.inboxId,
    ...(profile.name !== undefined ? { name: profile.name } : {}),
    ...(profile.encryptedImage !== undefined
      ? { imageUrl: profile.encryptedImage.url }
      : {}),
    ...(memberKind !== undefined ? { memberKind } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

/**
 * Create the Convos implementation of the shared onboarding-scheme contract.
 *
 * This is a thin wrapper around the existing Convos invite, join, profile, and
 * codec modules; it intentionally does not change any wire behavior.
 */
export function createConvosOnboardingScheme(): OnboardingScheme {
  return {
    id: "convos",

    async generate(conversation, creator, metadata, options) {
      const slugResult = await generateConvosInviteSlug(
        toGenerateInviteSlugOptions(
          conversation.groupId,
          conversation.format,
          creator,
          metadata,
          options,
        ),
      );
      if (slugResult.isErr()) return slugResult;

      const baseUrl = resolveInviteBaseUrl(options.env);
      const slug = slugResult.value;
      return Result.ok({
        url: `${baseUrl}?i=${encodeURIComponent(slug)}`,
        slug,
      });
    },

    parse(input) {
      return toParsedInvite(parseConvosInviteUrl(input));
    },

    verify(invite) {
      const convosInvite = toConvosParsedInvite(invite);
      if (convosInvite.isErr()) return convosInvite;
      return verifyConvosInvite(convosInvite.value);
    },

    async processJoinRequest(host, message) {
      const result = await processJoinRequest(
        {
          walletPrivateKeyHex: host.walletPrivateKeyHex,
          creatorInboxId: host.creatorInboxId,
          addMembersToGroup: host.addMembersToGroup,
          getGroupInviteTag: host.getGroupInviteTag,
        },
        {
          senderInboxId: message.senderInboxId,
          content: message.content,
        } satisfies IncomingJoinRequestMessage,
      );
      if (result.isErr()) return result;

      return Result.ok<ProcessedJoinRequest, SignetError>({
        groupId: result.value.groupId,
        requesterInboxId: result.value.requesterInboxId,
        inviteTag: result.value.inviteTag,
      });
    },

    encodeProfileUpdate(profile) {
      return encodeProfileUpdate(
        toProfileUpdateContent(profile),
      ) as EncodedOnboardingContent;
    },

    encodeProfileSnapshot(members) {
      const snapshot: ProfileSnapshotContent = {
        profiles: members.map(toMemberProfileEntry),
      };
      return encodeProfileSnapshot(snapshot) as EncodedOnboardingContent;
    },

    resolveProfilesFromHistory(messages, memberInboxIds) {
      const resolved = resolveProfilesFromMessages(messages, memberInboxIds);
      return new Map(
        Array.from(resolved.entries(), ([inboxId, profile]) => [
          inboxId,
          toResolvedProfile(profile),
        ]),
      );
    },

    codecs() {
      return createConvosCodecs();
    },

    isEncodedContent(value): value is EncodedOnboardingContent {
      return isEncodedConvosContent(value);
    },

    isJoinRequestContentType(contentType) {
      return isJoinRequestContentType(contentType);
    },

    joinRequestContentType() {
      return formatContentType(ContentTypeJoinRequest);
    },

    errorContentType() {
      return formatContentType(ContentTypeInviteJoinError);
    },

    profileUpdateContentType() {
      return formatContentType(ContentTypeProfileUpdate);
    },

    profileSnapshotContentType() {
      return formatContentType(ContentTypeProfileSnapshot);
    },
  };
}
