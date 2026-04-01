import { Result } from "better-result";
import { z } from "zod";
import type { ActionSpec } from "@xmtp/signet-contracts";
import {
  WalletProvider,
  type SignetError,
  type WalletProviderType,
} from "@xmtp/signet-schemas";
import type { AccountInfo, WalletInfo } from "./key-backend.js";
import type { KeyManager } from "./key-manager-compat.js";

/** Dependencies required to expose wallet actions through the runtime. */
export interface WalletActionDeps {
  readonly keyManager: KeyManager;
}

type WalletDetails = WalletInfo & {
  readonly accounts: readonly AccountInfo[];
};

const WalletInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: WalletProvider as z.ZodType<WalletProviderType>,
  accountCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});

const AccountInfoSchema = z.object({
  index: z.number().int().nonnegative(),
  address: z.string(),
  chain: z.union([z.literal("evm"), z.literal("ed25519")]),
  publicKey: z.string(),
});

const WalletDetailsSchema: z.ZodType<WalletDetails> = WalletInfoSchema.extend({
  accounts: z.array(AccountInfoSchema),
});

function widenActionSpec<TInput, TOutput>(
  spec: ActionSpec<TInput, TOutput, SignetError>,
): ActionSpec<unknown, unknown, SignetError> {
  return spec as ActionSpec<unknown, unknown, SignetError>;
}

/** Create wallet lifecycle actions for the CLI and admin surfaces. */
export function createWalletActions(
  deps: WalletActionDeps,
): ActionSpec<unknown, unknown, SignetError>[] {
  const create: ActionSpec<{ label: string }, WalletInfo, SignetError> = {
    id: "wallet.create",
    description: "Create a new managed wallet",
    intent: "write",
    input: z.object({
      label: z.string().min(1),
    }),
    output: WalletInfoSchema,
    handler: async (input) => deps.keyManager.createWallet(input.label),
    cli: {
      command: "wallet:create",
    },
    http: {
      auth: "admin",
    },
  };

  const list: ActionSpec<
    Record<string, never>,
    readonly WalletInfo[],
    SignetError
  > = {
    id: "wallet.list",
    description: "List all managed wallets",
    intent: "read",
    idempotent: true,
    input: z.object({}),
    output: z.array(WalletInfoSchema),
    handler: async () => deps.keyManager.listWallets(),
    cli: {
      command: "wallet:list",
    },
    http: {
      auth: "admin",
    },
  };

  const info: ActionSpec<{ walletId: string }, WalletDetails, SignetError> = {
    id: "wallet.info",
    description: "Show wallet details and derived accounts",
    intent: "read",
    idempotent: true,
    input: z.object({
      walletId: z.string().min(1),
    }),
    output: WalletDetailsSchema,
    handler: async (input) => {
      const wallet = await deps.keyManager.getWallet(input.walletId);
      if (Result.isError(wallet)) {
        return wallet;
      }

      const accounts = await deps.keyManager.listWalletAccounts(input.walletId);
      if (Result.isError(accounts)) {
        return accounts;
      }

      return Result.ok({
        ...wallet.value,
        accounts: [...accounts.value],
      });
    },
    cli: {
      command: "wallet:info",
    },
    http: {
      auth: "admin",
    },
  };

  return [
    widenActionSpec(create),
    widenActionSpec(list),
    widenActionSpec(info),
  ];
}
