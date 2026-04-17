import { Result } from "better-result";
import type { SignetError } from "@xmtp/signet-schemas";
import { InternalError } from "@xmtp/signet-schemas";
import type { Client as NodeSdkClient } from "@xmtp/node-sdk";
import type {
  XmtpClientFactory,
  XmtpClientCreateOptions,
  XmtpClient,
} from "../xmtp-client-factory.js";
import { createXmtpSigner } from "./signer-adapter.js";
import type { SdkEoaSigner } from "./signer-adapter.js";
import { createSdkClient } from "./sdk-client.js";
import type { SdkClientShape } from "./sdk-types.js";
import { createConvosOnboardingScheme } from "../convos/onboarding-scheme.js";
import type { OnboardingScheme } from "../schemes/onboarding-scheme.js";

/**
 * A function that creates a native SDK client.
 * In production, this wraps `Client.create()` from @xmtp/node-sdk.
 * In tests, this returns a mock.
 */
export type SdkCreateClientFn = (
  signer: SdkEoaSigner,
  options: {
    dbPath: string;
    dbEncryptionKey: Uint8Array;
    env: string;
    appVersion: string;
    disableDeviceSync: boolean;
    codecs: NodeSdkCodecs;
  },
) => Promise<SdkClientShape>;

/** Options for creating the factory (allows injecting SDK create fn). */
export interface SdkClientFactoryOptions {
  /** Override the SDK Client.create function (for testing). */
  readonly sdkCreateClient?: SdkCreateClientFn;
  /** Onboarding scheme that owns custom codecs and content handling. */
  readonly onboardingScheme?: OnboardingScheme;
}

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const DEFAULT_ONBOARDING_SCHEME = createConvosOnboardingScheme();
type NodeSdkCreateOptions = Parameters<typeof NodeSdkClient.create>[1];
type NodeSdkSigner = Parameters<typeof NodeSdkClient.create>[0];
type NodeSdkCodecs = NonNullable<NonNullable<NodeSdkCreateOptions>["codecs"]>;

/**
 * Creates a production XmtpClientFactory backed by @xmtp/node-sdk.
 *
 * Each call to create():
 * 1. Builds a Signer from the secp256k1 private key in options.
 * 2. Calls the SDK's Client.create() with the signer and options.
 * 3. Wraps the resulting Client in an SdkClient adapter.
 */
export function createSdkClientFactory(
  factoryOptions?: SdkClientFactoryOptions,
): XmtpClientFactory {
  const sdkCreate = factoryOptions?.sdkCreateClient ?? defaultSdkCreate;
  const onboardingScheme =
    factoryOptions?.onboardingScheme ?? DEFAULT_ONBOARDING_SCHEME;

  return {
    async create(
      options: XmtpClientCreateOptions,
    ): Promise<Result<XmtpClient, SignetError>> {
      try {
        const signer = createXmtpSigner({
          privateKey: options.signerPrivateKey,
        });

        const nativeClient = await sdkCreate(signer, {
          dbPath: options.dbPath,
          dbEncryptionKey: options.dbEncryptionKey,
          env: options.env,
          appVersion: options.appVersion,
          disableDeviceSync: true,
          codecs: onboardingScheme.codecs(),
        });

        const client = createSdkClient({
          client: nativeClient,
          syncTimeoutMs: DEFAULT_SYNC_TIMEOUT_MS,
          onboardingScheme,
        });

        return Result.ok(client);
      } catch (thrown: unknown) {
        const message =
          thrown instanceof Error ? thrown.message : String(thrown);
        return Result.err(
          InternalError.create(`Failed to create SDK client: ${message}`, {
            cause: message,
            identityId: options.identityId,
          }),
        );
      }
    },
  };
}

/**
 * Default SDK create function that dynamically imports @xmtp/node-sdk.
 * This allows the package to be used even if native bindings aren't available.
 */
async function defaultSdkCreate(
  signer: SdkEoaSigner,
  options: {
    dbPath: string;
    dbEncryptionKey: Uint8Array;
    env: string;
    appVersion: string;
    disableDeviceSync: boolean;
    codecs: NodeSdkCodecs;
  },
): Promise<SdkClientShape> {
  // Dynamic import so native binding errors surface at runtime, not import time
  const { Client } = await import("@xmtp/node-sdk");

  // Adapt our structural SdkEoaSigner to the SDK's Signer type.
  // IdentifierKind values (const enum, can't be imported at runtime
  // with verbatimModuleSyntax): Ethereum = 0, Passkey = 1.
  const IDENTIFIER_KIND_MAP: Record<string, number> = {
    Ethereum: 0,
    Passkey: 1,
  };
  const sdkSigner: NodeSdkSigner = {
    type: "EOA" as const,
    getIdentifier() {
      const id = signer.getIdentifier();
      // Handle both sync and async returns
      if (id instanceof Promise) {
        return id.then((resolved) => ({
          identifier: resolved.identifier,
          identifierKind: IDENTIFIER_KIND_MAP[resolved.identifierKind] ?? 0,
        }));
      }
      return {
        identifier: id.identifier,
        identifierKind: IDENTIFIER_KIND_MAP[id.identifierKind] ?? 0,
      };
    },
    signMessage: (message: string) => signer.signMessage(message),
  };
  const clientOptions: NodeSdkCreateOptions = options;

  const client = await Client.create(sdkSigner, clientOptions);
  // The SDK Client is structurally compatible with SdkClientShape
  return client as unknown as SdkClientShape;
}
