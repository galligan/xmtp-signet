import type { Client as NodeSdkClient } from "@xmtp/node-sdk";
import { JoinRequestCodec } from "./join-request-content.js";
import { InviteJoinErrorCodec } from "./invite-join-error.js";
import {
  ProfileSnapshotCodec,
  ProfileUpdateCodec,
} from "./profile-messages.js";

type NodeSdkCodecs = NonNullable<
  NonNullable<Parameters<typeof NodeSdkClient.create>[1]>["codecs"]
>;

/** Returns the Convos custom-content codecs that Signet should register. */
export function createConvosCodecs(): NodeSdkCodecs {
  return [
    new ProfileUpdateCodec(),
    new ProfileSnapshotCodec(),
    new JoinRequestCodec(),
    new InviteJoinErrorCodec(),
  ];
}
