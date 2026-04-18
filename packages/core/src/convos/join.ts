import { Result } from "better-result";
import { TimeoutError, ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import type { SqliteIdentityStore } from "../identity-store.js";
import type { XmtpClientFactory } from "../xmtp-client-factory.js";
import type { XmtpEnv, SignetCoreConfig } from "../config.js";
import type { SignerProviderFactory } from "../identity-registration.js";
import { registerIdentity } from "../identity-registration.js";
import type { OnboardingScheme } from "../schemes/onboarding-scheme.js";
import {
  extractInviteJoinError,
  getInviteJoinErrorMessage,
  isInviteJoinErrorContentType,
} from "./invite-join-error.js";
import type { JoinRequestContent } from "./join-request-content.js";

/** Dependencies injected into the join orchestrator. */
export interface JoinConversationDeps {
  readonly onboardingScheme: OnboardingScheme;
  readonly identityStore: SqliteIdentityStore;
  readonly clientFactory: XmtpClientFactory;
  readonly signerProviderFactory: SignerProviderFactory;
  readonly config: Pick<SignetCoreConfig, "dataDir" | "env" | "appVersion">;
}

/** Options for joining a conversation. */
export interface JoinConversationOptions {
  /** Human-readable label for the new identity. */
  readonly label?: string;
  /** Optional Convos profile name to publish for the joined identity. */
  readonly profileName?: string;
  /** Milliseconds between poll attempts for group discovery. */
  readonly pollIntervalMs?: number;
  /** Maximum number of poll attempts before timing out. */
  readonly maxPollAttempts?: number;
}

/** Result of a successful join. */
export interface JoinResult {
  /** The identity ID of the newly created identity. */
  readonly identityId: string;
  /** The inbox ID assigned by XMTP. */
  readonly inboxId: string;
  /** The group ID of the joined conversation. */
  readonly groupId: string;
  /** The invite tag from the parsed invite. */
  readonly inviteTag: string;
  /** The group name, if available. */
  readonly groupName: string | undefined;
  /** The creator's inbox ID. */
  readonly creatorInboxId: string;
  /** The profile name selected for this join, if any. */
  readonly profileName?: string;
  /** Whether the best-effort profile update succeeded after the join. */
  readonly profileApplied?: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLL_ATTEMPTS = 30; // 60 seconds at default interval

/**
 * Extract the raw slug from an invite URL for sending as a DM join request.
 */
function extractSlugForDm(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const iParam = url.searchParams.get("i");
    if (iParam) return iParam;
    const codeParam = url.searchParams.get("code");
    if (codeParam) return codeParam;
  } catch {
    // Raw slug
  }
  return trimmed;
}

function findInviteJoinErrorReply(
  messages: readonly {
    senderInboxId: string;
    contentType: string;
    content: unknown;
  }[],
  creatorInboxId: string,
  inviteTag: string,
): string | undefined {
  const normalizedCreatorInboxId = creatorInboxId.toLowerCase();

  for (const message of messages) {
    if (message.senderInboxId.toLowerCase() !== normalizedCreatorInboxId) {
      continue;
    }
    if (!isInviteJoinErrorContentType(message.contentType)) {
      continue;
    }

    const inviteJoinError = extractInviteJoinError(message.content);
    if (!inviteJoinError) {
      continue;
    }
    if (inviteJoinError.inviteTag !== inviteTag) {
      continue;
    }

    return getInviteJoinErrorMessage(inviteJoinError);
  }

  return undefined;
}

/**
 * Join a Convos conversation via an invite URL.
 *
 * Protocol:
 * 1. Parse and verify the invite URL
 * 2. Check expiration
 * 3. Create a new per-conversation identity and XMTP client
 * 4. Create a DM with the creator's inbox ID
 * 5. Send the structured join request and text fallback via DM
 * 6. Poll for group discovery (creator adds joiner to the group)
 * 7. Return the joined group info
 *
 * On failure, cleans up the created identity.
 */
export async function joinConversation(
  deps: JoinConversationDeps,
  inviteUrl: string,
  options?: JoinConversationOptions,
): Promise<Result<JoinResult, SignetError>> {
  const {
    onboardingScheme,
    identityStore,
    clientFactory,
    signerProviderFactory,
    config,
  } = deps;
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options?.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  // Step 1: Parse invite
  const parseResult = onboardingScheme.parse(inviteUrl);
  if (!parseResult.isOk()) return parseResult;

  const invite = parseResult.value;

  // Step 2: Verify signature structure
  const verifyResult = onboardingScheme.verify(invite);
  if (!verifyResult.isOk()) return verifyResult;

  // Step 3: Check expiration
  if (invite.isExpired) {
    return Result.err(
      ValidationError.create("inviteUrl", "Invite has expired"),
    );
  }
  if (invite.isConversationExpired) {
    return Result.err(
      ValidationError.create("inviteUrl", "Conversation has expired"),
    );
  }

  // Step 4: Create a new identity for this conversation
  const registerInput: { label?: string } = {};
  if (options?.label !== undefined) registerInput.label = options.label;

  const registerResult = await registerIdentity(
    { identityStore, clientFactory, signerProviderFactory, config },
    registerInput,
  );

  if (!registerResult.isOk()) return registerResult;

  const { identityId, inboxId } = registerResult.value;

  // We need the XmtpClient instance to create DMs and poll for groups.
  // Re-create the client (registerIdentity already created one but doesn't expose it).
  const signer = signerProviderFactory(identityId);
  const dbKeyResult = await signer.getDbEncryptionKey(identityId);
  if (!dbKeyResult.isOk()) {
    await identityStore.remove(identityId);
    return dbKeyResult;
  }

  const identityKeyResult = await signer.getXmtpIdentityKey(identityId);
  if (!identityKeyResult.isOk()) {
    await identityStore.remove(identityId);
    return identityKeyResult;
  }

  const resolveDbPath = (dataDir: string, env: XmtpEnv, id: string): string =>
    dataDir === ":memory:" ? ":memory:" : `${dataDir}/db/${env}/${id}.db3`;

  const clientResult = await clientFactory.create({
    identityId,
    dbPath: resolveDbPath(config.dataDir, config.env, identityId),
    dbEncryptionKey: dbKeyResult.value,
    env: config.env,
    appVersion: config.appVersion,
    signerPrivateKey: identityKeyResult.value,
  });

  if (!clientResult.isOk()) {
    await identityStore.remove(identityId);
    return clientResult;
  }

  const client = clientResult.value;

  // Step 5: Create DM with creator and send join request
  const dmResult = await client.createDm(invite.creatorInboxId);
  if (!dmResult.isOk()) {
    await identityStore.remove(identityId);
    return dmResult;
  }

  const slug = extractSlugForDm(inviteUrl);
  const joinRequest: JoinRequestContent = {
    inviteSlug: slug,
    profile: {
      memberKind: "agent",
      ...(options?.profileName !== undefined
        ? { name: options.profileName }
        : {}),
    },
  };
  const structuredSendResult = await client.sendMessage(
    dmResult.value.dmId,
    joinRequest,
    onboardingScheme.joinRequestContentType(),
  );
  if (!structuredSendResult.isOk()) {
    await identityStore.remove(identityId);
    return structuredSendResult;
  }

  const sendResult = await client.sendDmMessage(dmResult.value.dmId, slug);
  if (!sendResult.isOk()) {
    // Keep polling after the structured request succeeds. Modern Convos hosts
    // can accept the join without the plain-text fallback, so treating this as
    // fatal creates a false local failure and encourages duplicate retries.
  }

  // Step 6: Poll for group discovery
  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    const syncResult = await client.syncAll();
    if (!syncResult.isOk()) {
      await identityStore.remove(identityId);
      return syncResult;
    }

    const groupsResult = await client.listGroups();
    if (!groupsResult.isOk()) {
      await identityStore.remove(identityId);
      return groupsResult;
    }

    const groups = groupsResult.value;
    if (groups.length > 0) {
      const group = groups[0];
      if (group !== undefined) {
        const profileUpdateResult = await client.sendMessage(
          group.groupId,
          onboardingScheme.encodeProfileUpdate({
            memberKind: "agent",
            ...(options?.profileName !== undefined
              ? { name: options.profileName }
              : {}),
          }),
          onboardingScheme.profileUpdateContentType(),
        );

        return Result.ok({
          identityId,
          inboxId,
          groupId: group.groupId,
          inviteTag: invite.tag,
          groupName: group.name || invite.name,
          creatorInboxId: invite.creatorInboxId,
          ...(options?.profileName !== undefined
            ? { profileName: options.profileName }
            : {}),
          profileApplied: profileUpdateResult.isOk(),
        });
      }
    }

    const rejectionMessagesResult = await client.listMessages(
      dmResult.value.dmId,
      {
        limit: 20,
        direction: "descending",
      },
    );
    if (rejectionMessagesResult.isOk()) {
      const rejectionMessage = findInviteJoinErrorReply(
        rejectionMessagesResult.value,
        invite.creatorInboxId,
        invite.tag,
      );
      if (rejectionMessage !== undefined) {
        await identityStore.remove(identityId);
        return Result.err(
          ValidationError.create("inviteUrl", rejectionMessage),
        );
      }
    }

    // Wait before next poll
    if (attempt < maxPollAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  // Step 7: Timeout -- clean up identity
  await identityStore.remove(identityId);
  const totalMs = maxPollAttempts * pollIntervalMs;
  return Result.err(TimeoutError.create("joinConversation", totalMs));
}
