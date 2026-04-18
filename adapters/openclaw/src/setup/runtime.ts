import { Result } from "better-result";
import { createKeyManager } from "@xmtp/signet-keys";
import { AuthError, type SignetError } from "@xmtp/signet-schemas";
import {
  createAdminClient,
  loadConfig,
  resolvePaths,
  type AdminClient,
  type CliConfig,
  type ResolvedPaths,
} from "@xmtp/signet-cli";

/** Context available to OpenClaw adapter setup/status/doctor handlers. */
export interface OpenClawAdminContext {
  readonly config: CliConfig;
  readonly paths: ResolvedPaths;
}

/** Helper that authenticates to the signet daemon as an admin. */
export async function withOpenClawAdminClient<T>(
  options: {
    readonly configPath: string;
  },
  run: (
    client: AdminClient,
    context: OpenClawAdminContext,
  ) => Promise<Result<T, SignetError>>,
): Promise<Result<T, SignetError>> {
  const configResult = await loadConfig({ configPath: options.configPath });
  if (configResult.isErr()) {
    return configResult;
  }

  const config = configResult.value;
  const paths = resolvePaths(config);
  const keyManagerResult = await createKeyManager({
    rootKeyPolicy: config.keys.rootKeyPolicy,
    operationalKeyPolicy: config.keys.operationalKeyPolicy,
    vaultKeyPolicy: config.keys.vaultKeyPolicy,
    biometricGating: config.biometricGating,
    dataDir: paths.dataDir,
  });
  if (keyManagerResult.isErr()) {
    return keyManagerResult;
  }

  const keyManager = keyManagerResult.value;
  const client = createAdminClient(paths.adminSocket);

  try {
    const initResult = await keyManager.initialize();
    if (initResult.isErr()) {
      return initResult;
    }

    if (!keyManager.admin.exists()) {
      return Result.err(
        AuthError.create("No admin key found. Run 'xs init' first."),
      );
    }

    const tokenResult = await keyManager.admin.signJwt({ ttlSeconds: 120 });
    if (tokenResult.isErr()) {
      return tokenResult;
    }

    const connectResult = await client.connect(tokenResult.value);
    if (connectResult.isErr()) {
      return connectResult;
    }

    return await run(client, {
      config,
      paths,
    });
  } finally {
    await client.close();
    keyManager.close?.();
  }
}
