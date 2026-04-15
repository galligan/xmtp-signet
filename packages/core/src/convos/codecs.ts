import { JoinRequestCodec } from "./join-request-content.js";
import { InviteJoinErrorCodec } from "./invite-join-error.js";
import {
  ProfileSnapshotCodec,
  ProfileUpdateCodec,
} from "./profile-messages.js";

/** Returns the Convos custom-content codecs that Signet should register. */
export function createConvosCodecs(): unknown[] {
  return [
    new ProfileUpdateCodec(),
    new ProfileSnapshotCodec(),
    new JoinRequestCodec(),
    new InviteJoinErrorCodec(),
  ];
}
