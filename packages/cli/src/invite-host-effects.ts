import { Result } from "better-result";
import {
  extractJoinRequestContent,
  type ListMessagesOptions,
  type MemberProfileData,
  type OnboardingScheme,
  type ResolvedOnboardingProfile,
  type XmtpDecodedMessage,
  type XmtpGroupInfo,
} from "@xmtp/signet-core";
import type { SignetError } from "@xmtp/signet-schemas";
import type { AuditEntry, AuditLog } from "./audit/log.js";
import type {
  ManagedInviteJoinAcceptance,
  ManagedInviteJoinFailure,
} from "./invite-host-listener.js";

const PROFILE_SNAPSHOT_SCAN_OPTIONS = {
  limit: 500,
  direction: "descending",
} satisfies ListMessagesOptions;

interface InviteHostEffectsClient {
  readonly getGroupInfo: (
    groupId: string,
  ) => Promise<Result<XmtpGroupInfo, SignetError>>;
  readonly listMessages: (
    groupId: string,
    options?: ListMessagesOptions,
  ) => Promise<Result<readonly XmtpDecodedMessage[], SignetError>>;
  readonly sendMessage: (
    groupId: string,
    content: unknown,
    contentType?: string,
  ) => Promise<Result<string, SignetError>>;
}

/** Dependencies for audit and profile-side effects after invite handling. */
export interface InviteHostEffectsDeps {
  readonly auditLog: AuditLog;
  readonly getManagedClientForGroup: (
    groupId: string,
  ) => InviteHostEffectsClient | undefined;
  readonly onboardingScheme: OnboardingScheme;
  readonly resolveLocalChatId?: (groupId: string) => string | undefined;
  readonly now?: () => Date;
}

function entryTimestamp(deps: InviteHostEffectsDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

function joinFailureAction(
  category: SignetError["category"],
): "convos.join-request.rejected" | "convos.join-request.failed" {
  switch (category) {
    case "validation":
    case "permission":
    case "auth":
      return "convos.join-request.rejected";
    case "internal":
    case "timeout":
    case "cancelled":
    default:
      return "convos.join-request.failed";
  }
}

async function appendAudit(
  deps: InviteHostEffectsDeps,
  entry: AuditEntry,
): Promise<void> {
  await deps.auditLog.append(entry);
}

async function appendSnapshotAudit(
  deps: InviteHostEffectsDeps,
  acceptance: ManagedInviteJoinAcceptance,
  action: "convos.profile-snapshot.sent" | "convos.profile-snapshot.failed",
  success: boolean,
  detail: Record<string, unknown>,
): Promise<void> {
  await appendAudit(deps, {
    timestamp: entryTimestamp(deps),
    action,
    actor: "system",
    target: acceptance.join.groupId,
    success,
    detail: {
      groupId: acceptance.join.groupId,
      localChatId: deps.resolveLocalChatId?.(acceptance.join.groupId),
      inviteTag: acceptance.join.inviteTag,
      joinerInboxId: acceptance.join.requesterInboxId,
      hostIdentityId: acceptance.hostIdentityId,
      hostInboxId: acceptance.hostInboxId,
      dmId: acceptance.requestMessage.groupId,
      requestMessageId: acceptance.requestMessage.messageId,
      ...detail,
    },
  });
}

function applyAcceptedJoinProfile(
  acceptance: ManagedInviteJoinAcceptance,
  snapshotMembers: readonly MemberProfileData[],
): readonly MemberProfileData[] {
  const requestedProfile = extractJoinRequestContent(
    acceptance.requestMessage.content,
  )?.profile;
  if (!requestedProfile) {
    return snapshotMembers;
  }

  const requestedMemberKind =
    requestedProfile.memberKind === "agent"
      ? "agent"
      : requestedProfile.memberKind === "human"
        ? "human"
        : undefined;
  const joinerInboxId = acceptance.join.requesterInboxId.toLowerCase();

  return snapshotMembers.map((profile) => {
    if (profile.inboxId.toLowerCase() !== joinerInboxId) {
      return profile;
    }

    return {
      ...profile,
      ...(requestedProfile.name !== undefined
        ? { name: requestedProfile.name }
        : {}),
      ...(requestedMemberKind !== undefined
        ? { memberKind: requestedMemberKind }
        : {}),
    };
  });
}

function hasMaterializedProfile(
  profile: ResolvedOnboardingProfile | undefined,
): boolean {
  return (
    profile !== undefined &&
    (profile.name !== undefined ||
      profile.imageUrl !== undefined ||
      profile.memberKind !== undefined ||
      profile.metadata !== undefined)
  );
}

async function loadProfileSnapshotMessages(
  deps: InviteHostEffectsDeps,
  managed: InviteHostEffectsClient,
  groupId: string,
  memberInboxIds: readonly string[],
): Promise<Result<readonly XmtpDecodedMessage[], SignetError>> {
  const collected: XmtpDecodedMessage[] = [];
  let before: string | undefined;

  while (true) {
    const listOptions = before
      ? { ...PROFILE_SNAPSHOT_SCAN_OPTIONS, before }
      : PROFILE_SNAPSHOT_SCAN_OPTIONS;
    const messagesResult = await managed.listMessages(groupId, listOptions);
    if (Result.isError(messagesResult)) {
      return messagesResult;
    }

    if (messagesResult.value.length === 0) {
      return Result.ok(collected);
    }

    collected.push(...messagesResult.value);

    const resolvedProfiles = deps.onboardingScheme.resolveProfilesFromHistory(
      collected,
      memberInboxIds,
    );
    if (
      memberInboxIds.every((inboxId) =>
        hasMaterializedProfile(resolvedProfiles.get(inboxId.toLowerCase())),
      )
    ) {
      return Result.ok(collected);
    }

    if (messagesResult.value.length < PROFILE_SNAPSHOT_SCAN_OPTIONS.limit) {
      return Result.ok(collected);
    }

    const oldestMessage = messagesResult.value[messagesResult.value.length - 1];
    before = oldestMessage?.sentAt;
    if (!before) {
      return Result.ok(collected);
    }
  }
}

/** Creates best-effort audit and profile side effects for hosted invite flows. */
export function createInviteHostEffects(deps: InviteHostEffectsDeps): {
  readonly onJoinAccepted: (
    acceptance: ManagedInviteJoinAcceptance,
  ) => Promise<void>;
  readonly onJoinRejected: (failure: ManagedInviteJoinFailure) => Promise<void>;
} {
  return {
    async onJoinAccepted(acceptance): Promise<void> {
      await appendAudit(deps, {
        timestamp: entryTimestamp(deps),
        action: "convos.join-request.accepted",
        actor: "system",
        target: acceptance.join.groupId,
        success: true,
        detail: {
          groupId: acceptance.join.groupId,
          localChatId: deps.resolveLocalChatId?.(acceptance.join.groupId),
          inviteTag: acceptance.join.inviteTag,
          joinerInboxId: acceptance.join.requesterInboxId,
          hostIdentityId: acceptance.hostIdentityId,
          hostInboxId: acceptance.hostInboxId,
          dmId: acceptance.requestMessage.groupId,
          requestMessageId: acceptance.requestMessage.messageId,
        },
      });

      const managed = deps.getManagedClientForGroup(acceptance.join.groupId);
      if (!managed) {
        await appendSnapshotAudit(
          deps,
          acceptance,
          "convos.profile-snapshot.failed",
          false,
          { errorMessage: "Managed client unavailable for accepted group" },
        );
        return;
      }

      const groupInfoResult = await managed.getGroupInfo(
        acceptance.join.groupId,
      );
      if (Result.isError(groupInfoResult)) {
        await appendSnapshotAudit(
          deps,
          acceptance,
          "convos.profile-snapshot.failed",
          false,
          {
            errorCategory: groupInfoResult.error.category,
            errorMessage: groupInfoResult.error.message,
            stage: "groupInfo",
          },
        );
        return;
      }

      const messagesResult = await loadProfileSnapshotMessages(
        deps,
        managed,
        acceptance.join.groupId,
        groupInfoResult.value.memberInboxIds,
      );
      if (Result.isError(messagesResult)) {
        await appendSnapshotAudit(
          deps,
          acceptance,
          "convos.profile-snapshot.failed",
          false,
          {
            errorCategory: messagesResult.error.category,
            errorMessage: messagesResult.error.message,
            stage: "listMessages",
          },
        );
        return;
      }

      const resolvedProfiles = deps.onboardingScheme.resolveProfilesFromHistory(
        messagesResult.value,
        groupInfoResult.value.memberInboxIds,
      );
      const snapshotMembers = applyAcceptedJoinProfile(
        acceptance,
        groupInfoResult.value.memberInboxIds.map(
          (inboxId) =>
            resolvedProfiles.get(inboxId.toLowerCase()) ?? {
              inboxId,
            },
        ),
      );
      if (snapshotMembers.length === 0) {
        return;
      }

      const sendResult = await managed.sendMessage(
        acceptance.join.groupId,
        deps.onboardingScheme.encodeProfileSnapshot(snapshotMembers),
        deps.onboardingScheme.profileSnapshotContentType(),
      );
      if (Result.isError(sendResult)) {
        await appendSnapshotAudit(
          deps,
          acceptance,
          "convos.profile-snapshot.failed",
          false,
          {
            errorCategory: sendResult.error.category,
            errorMessage: sendResult.error.message,
            profileCount: snapshotMembers.length,
            stage: "sendMessage",
          },
        );
        return;
      }

      await appendSnapshotAudit(
        deps,
        acceptance,
        "convos.profile-snapshot.sent",
        true,
        {
          messageId: sendResult.value,
          profileCount: snapshotMembers.length,
        },
      );
    },

    async onJoinRejected(failure): Promise<void> {
      await appendAudit(deps, {
        timestamp: entryTimestamp(deps),
        action: joinFailureAction(failure.error.category),
        actor: "system",
        target: failure.requestMessage.groupId,
        success: false,
        detail: {
          dmId: failure.requestMessage.groupId,
          requestMessageId: failure.requestMessage.messageId,
          joinerInboxId: failure.requestMessage.senderInboxId,
          contentType: failure.requestMessage.contentType,
          errorCategory: failure.error.category,
          errorMessage: failure.error.message,
        },
      });
    },
  };
}
