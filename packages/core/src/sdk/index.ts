/**
 * SDK integration layer. Wraps `@xmtp/node-sdk` behind signet-owned
 * interfaces so domain code never touches SDK types directly.
 * @module
 */

export { createSdkClientFactory } from "./sdk-client-factory.js";
export type { SdkClientFactoryOptions } from "./sdk-client-factory.js";
export { createSdkClient } from "./sdk-client.js";
export type { SdkClientOptions } from "./sdk-client.js";
export { createXmtpSigner } from "./signer-adapter.js";
export type {
  SdkEoaSigner,
  SdkIdentifier,
  XmtpSignerConfig,
} from "./signer-adapter.js";
export type {
  SdkClientShape,
  SdkGroupShape,
  SdkGroupMemberShape,
  SdkDecodedMessageShape,
  SdkAsyncStreamProxyShape,
  SdkConversationsShape,
  SdkContentTypeIdShape,
  SdkIdentifierShape,
} from "./sdk-types.js";
export { wrapSdkCall } from "./error-mapping.js";
export type { WrapSdkCallHints } from "./error-mapping.js";
export { wrapMessageStream, wrapGroupStream } from "./stream-wrappers.js";
export { toGroupInfo, toDecodedMessage } from "./type-mapping.js";
