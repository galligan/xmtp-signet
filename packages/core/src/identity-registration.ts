import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Result } from "better-result";
import { InternalError } from "@xmtp/signet-schemas";
import type { SignetError } from "@xmtp/signet-schemas";
import { privateKeyToAccount } from "viem/accounts";
import type { SqliteIdentityStore } from "./identity-store.js";
import type {
  XmtpClientFactory,
  SignerProviderLike,
} from "./xmtp-client-factory.js";
import type { XmtpEnv, SignetCoreConfig } from "./config.js";

/** Factory that creates a signer provider scoped to an identity. */
export type SignerProviderFactory = (identityId: string) => SignerProviderLike;

/** Dependencies injected into the registration orchestrator. */
export interface IdentityRegistrationDeps {
  readonly identityStore: SqliteIdentityStore;
  readonly clientFactory: XmtpClientFactory;
  readonly signerProviderFactory: SignerProviderFactory;
  readonly config: Pick<SignetCoreConfig, "dataDir" | "env" | "appVersion">;
}

/** Input for registering a new identity. */
export interface RegisterIdentityInput {
  readonly label?: string;
  readonly groupId?: string | null;
}

/** Output after successful identity registration. */
export interface RegisteredIdentity {
  readonly identityId: string;
  readonly inboxId: string;
  readonly address: string;
  readonly env: XmtpEnv;
  readonly label: string | undefined;
}

/**
 * Compute the XMTP client database path for an identity.
 *
 * If dataDir is ":memory:", returns ":memory:" (for tests).
 * Otherwise creates the parent directory and returns the full path.
 */
function resolveDbPath(
  dataDir: string,
  env: XmtpEnv,
  identityId: string,
): string {
  if (dataDir === ":memory:") return ":memory:";
  const dbPath = `${dataDir}/db/${env}/${identityId}.db3`;
  mkdirSync(dirname(dbPath), { recursive: true });
  return dbPath;
}

/**
 * Orchestrates registering a new XMTP identity on the network.
 *
 * 1. Creates an identity record in the store (inboxId starts null)
 * 2. Derives signing keys via the signer provider (get-or-create in vault)
 * 3. Calls XmtpClientFactory.create() which registers with XMTP network
 * 4. Persists the inbox ID back to the store
 * 5. On failure, cleans up the identity record
 */
export async function registerIdentity(
  deps: IdentityRegistrationDeps,
  input: RegisterIdentityInput,
): Promise<Result<RegisteredIdentity, SignetError>> {
  const { identityStore, clientFactory, signerProviderFactory, config } = deps;
  const groupId = input.groupId ?? null;

  // Step 1: Create identity record (inboxId starts null)
  const createResult = await identityStore.create(groupId, input.label);
  if (!createResult.isOk()) return createResult;

  const identity = createResult.value;
  const identityId = identity.id;

  // Step 2: Derive signing keys via signer provider
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

  // Compute address from the signer key
  const account = privateKeyToAccount(identityKeyResult.value);
  const address = account.address;

  // Step 3: Create XMTP client (registers with network)
  const dbPath = resolveDbPath(config.dataDir, config.env, identityId);
  const clientResult = await clientFactory.create({
    identityId,
    dbPath,
    dbEncryptionKey: dbKeyResult.value,
    env: config.env,
    appVersion: config.appVersion,
    signerPrivateKey: identityKeyResult.value,
  });

  if (!clientResult.isOk()) {
    // Step 5: Clean up on failure
    await identityStore.remove(identityId);
    return clientResult;
  }

  const client = clientResult.value;

  // Step 4: Persist inbox ID
  const setResult = await identityStore.setInboxId(identityId, client.inboxId);
  if (!setResult.isOk()) {
    await identityStore.remove(identityId);
    return Result.err(
      InternalError.create("Failed to persist inbox ID", {
        identityId,
        inboxId: client.inboxId,
      }),
    );
  }

  return Result.ok({
    identityId,
    inboxId: client.inboxId,
    address,
    env: config.env,
    label: input.label,
  });
}
