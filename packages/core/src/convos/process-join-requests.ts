import { Result } from "better-result";
import { ValidationError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { parseConvosInviteUrl } from "./invite-parser.js";
import { decryptConversationToken } from "./invite-generator.js";

// --- Types ---

/** Dependencies injected into the join request processor. */
export interface ProcessJoinRequestDeps {
  /** Hex-encoded secp256k1 private key of the creator (without 0x prefix). */
  readonly walletPrivateKeyHex: string;
  /** Hex-encoded inbox ID of the creator. */
  readonly creatorInboxId: string;
  /** Add inbox IDs to a group conversation. */
  readonly addMembersToGroup: (
    groupId: string,
    inboxIds: readonly string[],
  ) => Promise<Result<void, SignetError>>;
  /** Get the invite tag stored in a group's appData (for verification). */
  readonly getGroupInviteTag: (
    groupId: string,
  ) => Promise<Result<string | undefined, SignetError>>;
}

/** An incoming message to evaluate as a potential join request. */
export interface IncomingJoinMessage {
  /** Inbox ID of the message sender (the requester). */
  readonly senderInboxId: string;
  /** The text content of the DM. */
  readonly messageText: string;
}

/** Result of successfully processing a join request. */
export interface JoinRequestResult {
  /** The group ID the requester was added to. */
  readonly groupId: string;
  /** The inbox ID of the requester who was added. */
  readonly requesterInboxId: string;
  /** The invite tag from the processed invite. */
  readonly inviteTag: string;
}

// --- Hex helper ---

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verify that an invite's signature was produced by a specific private key.
 *
 * Recovers the signer's public key from the secp256k1 ECDSA signature
 * and compares it to the public key derived from the given private key.
 */
function verifySignatureMatchesKey(
  payloadBytes: Uint8Array,
  signatureBytes: Uint8Array,
  privateKeyBytes: Uint8Array,
): boolean {
  if (signatureBytes.length !== 65) return false;

  const messageHash = sha256(payloadBytes);
  const compactSig = signatureBytes.slice(0, 64);
  const recoveryBit = signatureBytes[64];

  if (recoveryBit === undefined || recoveryBit > 3) return false;

  try {
    const sig =
      secp256k1.Signature.fromCompact(compactSig).addRecoveryBit(recoveryBit);
    const recoveredPubKey = sig.recoverPublicKey(messageHash);

    // Derive expected public key from private key
    const expectedPubKey = secp256k1.getPublicKey(privateKeyBytes, false);

    return (
      recoveredPubKey.toHex(false) ===
      Buffer.from(expectedPubKey).toString("hex")
    );
  } catch {
    return false;
  }
}

/**
 * Process an incoming DM as a potential Convos join request.
 *
 * Steps:
 * 1. Parse the message text as an invite slug
 * 2. Check expiration
 * 3. Verify the invite was signed by the creator's wallet key
 * 4. Verify creator inbox ID matches
 * 5. Decrypt conversation token to get group ID
 * 6. Add the requester to the group
 */
export async function processJoinRequest(
  deps: ProcessJoinRequestDeps,
  message: IncomingJoinMessage,
): Promise<Result<JoinRequestResult, SignetError>> {
  // Step 1: Parse the message as an invite slug
  const parseResult = parseConvosInviteUrl(message.messageText);
  if (!parseResult.isOk()) return parseResult;

  const invite = parseResult.value;

  // Step 2: Check expiration
  if (invite.isExpired) {
    return Result.err(ValidationError.create("invite", "Invite has expired"));
  }
  if (invite.isConversationExpired) {
    return Result.err(
      ValidationError.create("invite", "Conversation has expired"),
    );
  }

  // Step 3: Verify signature matches creator's wallet key
  const privateKeyBytes = hexToBytes(deps.walletPrivateKeyHex);

  const signatureValid = verifySignatureMatchesKey(
    invite.signedInvitePayloadBytes,
    invite.signedInviteSignature,
    privateKeyBytes,
  );

  if (!signatureValid) {
    return Result.err(
      ValidationError.create(
        "invite",
        "Invite signature does not match creator wallet key",
      ),
    );
  }

  // Step 4: Verify creator inbox ID matches
  if (invite.creatorInboxId !== deps.creatorInboxId) {
    return Result.err(
      ValidationError.create(
        "invite",
        "Invite creator inbox ID does not match",
      ),
    );
  }

  // Step 5: Decrypt conversation token to get group ID
  let groupId: string;
  try {
    groupId = decryptConversationToken(
      invite.conversationToken,
      invite.creatorInboxId,
      privateKeyBytes,
    );
  } catch (cause) {
    return Result.err(
      ValidationError.create(
        "invite",
        `Failed to decrypt conversation token: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
    );
  }

  // Step 6: Add the requester to the group
  const addResult = await deps.addMembersToGroup(groupId, [
    message.senderInboxId,
  ]);
  if (!addResult.isOk()) return addResult;

  return Result.ok({
    groupId,
    requesterInboxId: message.senderInboxId,
    inviteTag: invite.tag,
  });
}
