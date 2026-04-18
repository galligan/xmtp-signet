import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import { Result } from "better-result";
import type { AdminClient, DaemonStatus } from "@xmtp/signet-cli";
import {
  AdapterSetupResult,
  type AdapterSetupResultType,
  InternalError,
  ValidationError,
  type OperatorConfigType,
  type OperatorRecordType,
  type PolicyConfigType,
  type PolicyRecordType,
  type SignetError,
} from "@xmtp/signet-schemas";
import { listOpenClawArtifactFiles } from "../artifacts/index.js";
import { OPENCLAW_ADAPTER_NAME } from "../config/index.js";
import { OPENCLAW_ADAPTER_MANIFEST } from "../registry.js";
import { withOpenClawAdminClient } from "./runtime.js";

const OPERATOR_TEMPLATES: readonly OperatorConfigType[] = [
  {
    label: "openclaw-main",
    role: "operator",
    scopeMode: "shared",
    provider: "internal",
  },
  {
    label: "openclaw-subagent-per-chat",
    role: "operator",
    scopeMode: "per-chat",
    provider: "internal",
  },
  {
    label: "openclaw-specialist-shared",
    role: "operator",
    scopeMode: "shared",
    provider: "internal",
  },
] as const;

const POLICY_TEMPLATES: readonly PolicyConfigType[] = [
  {
    label: "openclaw-readonly",
    allow: [
      "read-messages",
      "read-history",
      "list-members",
      "list-conversations",
      "read-permissions",
      "stream-messages",
      "stream-conversations",
    ],
    deny: ["send", "reply", "react", "attachment"],
  },
  {
    label: "openclaw-standard-reply",
    allow: [
      "send",
      "reply",
      "react",
      "read-receipt",
      "attachment",
      "read-messages",
      "read-history",
      "list-members",
      "list-conversations",
      "read-permissions",
      "stream-messages",
      "stream-conversations",
      "use-for-memory",
      "quote-revealed",
      "summarize",
    ],
    deny: [
      "add-member",
      "remove-member",
      "promote-admin",
      "demote-admin",
      "update-permission",
    ],
  },
  {
    label: "openclaw-draft-only",
    allow: [
      "read-messages",
      "read-history",
      "list-members",
      "list-conversations",
      "read-permissions",
      "stream-messages",
      "stream-conversations",
      "store-excerpts",
      "use-for-memory",
      "summarize",
    ],
    deny: ["send", "reply", "react", "attachment"],
  },
  {
    label: "openclaw-group-helper",
    allow: [
      "send",
      "reply",
      "react",
      "read-receipt",
      "attachment",
      "read-messages",
      "read-history",
      "list-members",
      "list-conversations",
      "read-permissions",
      "stream-messages",
      "stream-conversations",
      "invite",
      "add-member",
      "remove-member",
      "update-name",
      "update-description",
      "update-image",
      "use-for-memory",
      "quote-revealed",
      "summarize",
    ],
    deny: ["promote-admin", "demote-admin", "update-permission"],
  },
] as const;

/** Dependencies for OpenClaw setup orchestration. */
export interface OpenClawSetupDeps {
  readonly withAdminClient: typeof withOpenClawAdminClient;
  readonly mkdir: typeof mkdir;
  readonly writeFile: typeof writeFile;
  readonly pathExists: (path: string) => Promise<boolean>;
}

const defaultDeps: OpenClawSetupDeps = {
  withAdminClient: withOpenClawAdminClient,
  mkdir,
  writeFile,
  async pathExists(path) {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
};

type ProvisionedResource<T> = {
  readonly record: T;
  readonly wasCreated: boolean;
};

function ensureSingleMatch<T extends { id: string; config: { label: string } }>(
  records: readonly T[],
  label: string,
  resourceType: string,
): Result<T | undefined, SignetError> {
  const matches = records.filter((record) => record.config.label === label);
  if (matches.length <= 1) {
    return Result.ok(matches[0]);
  }

  return Result.err(
    ValidationError.create(
      `${resourceType}.label`,
      `Multiple ${resourceType}s already use label '${label}'`,
      {
        label,
        matches: matches.map((record) => record.id),
      },
    ),
  );
}

async function ensureOperator(
  client: AdminClient,
  config: OperatorConfigType,
): Promise<Result<ProvisionedResource<OperatorRecordType>, SignetError>> {
  const listResult = await client.request<readonly OperatorRecordType[]>(
    "operator.list",
    {},
  );
  if (listResult.isErr()) {
    return listResult;
  }

  const existingResult = ensureSingleMatch(
    listResult.value,
    config.label,
    "operator",
  );
  if (existingResult.isErr()) {
    return existingResult;
  }
  if (existingResult.value !== undefined) {
    return Result.ok({
      record: existingResult.value,
      wasCreated: false,
    });
  }

  const createResult = await client.request<OperatorRecordType>(
    "operator.create",
    config,
  );
  if (createResult.isErr()) {
    return createResult;
  }

  return Result.ok({
    record: createResult.value,
    wasCreated: true,
  });
}

async function ensurePolicy(
  client: AdminClient,
  config: PolicyConfigType,
): Promise<Result<ProvisionedResource<PolicyRecordType>, SignetError>> {
  const listResult = await client.request<readonly PolicyRecordType[]>(
    "policy.list",
    {},
  );
  if (listResult.isErr()) {
    return listResult;
  }

  const existingResult = ensureSingleMatch(
    listResult.value,
    config.label,
    "policy",
  );
  if (existingResult.isErr()) {
    return existingResult;
  }
  if (existingResult.value !== undefined) {
    return Result.ok({
      record: existingResult.value,
      wasCreated: false,
    });
  }

  const createResult = await client.request<PolicyRecordType>(
    "policy.create",
    config,
  );
  if (createResult.isErr()) {
    return createResult;
  }

  return Result.ok({
    record: createResult.value,
    wasCreated: true,
  });
}

function renderAdapterToml(options: {
  readonly wsPort: number;
  readonly operatorIds: Record<string, string>;
  readonly policyIds: Record<string, string>;
  readonly artifactDir: string;
}): string {
  return [
    `[adapter]`,
    `name = "openclaw"`,
    `source = "builtin"`,
    "",
    `[transport.ws]`,
    `host = "127.0.0.1"`,
    `port = ${options.wsPort}`,
    "",
    `[paths]`,
    `root = "${options.artifactDir}"`,
    `checkpoints = "${join(options.artifactDir, "checkpoints")}"`,
    "",
    `[operators]`,
    ...Object.entries(options.operatorIds).map(
      ([label, id]) => `${toTomlKey(label)} = "${id}"`,
    ),
    "",
    `[policies]`,
    ...Object.entries(options.policyIds).map(
      ([label, id]) => `${toTomlKey(label)} = "${id}"`,
    ),
    "",
  ].join("\n");
}

function renderManifestToml(): string {
  return [
    `name = "${OPENCLAW_ADAPTER_MANIFEST.name}"`,
    `source = "${OPENCLAW_ADAPTER_MANIFEST.source}"`,
    `supports = ["setup", "status", "doctor"]`,
    "",
    `[entrypoints]`,
    `setup = "${OPENCLAW_ADAPTER_MANIFEST.entrypoints.setup}"`,
    `status = "${OPENCLAW_ADAPTER_MANIFEST.entrypoints.status}"`,
    `doctor = "${OPENCLAW_ADAPTER_MANIFEST.entrypoints.doctor}"`,
    "",
  ].join("\n");
}

function toTomlKey(label: string): string {
  return label.replace(/-/g, "_");
}

async function writeArtifact(
  deps: OpenClawSetupDeps,
  options: {
    readonly path: string;
    readonly contents: string;
    readonly force: boolean;
  },
): Promise<"created" | "reused"> {
  const exists = await deps.pathExists(options.path);
  if (exists && !options.force) {
    return "reused";
  }

  await deps.writeFile(options.path, options.contents);
  return "created";
}

async function ensureSetupPrerequisites(
  client: AdminClient,
): Promise<Result<DaemonStatus, SignetError>> {
  const statusResult = await client.request<DaemonStatus>("signet.status", {});
  if (statusResult.isErr()) {
    return statusResult;
  }

  if (statusResult.value.state !== "running") {
    return Result.err(
      ValidationError.create(
        "signet.status",
        "Signet daemon must be running before adapter setup",
        {
          state: statusResult.value.state,
        },
      ),
    );
  }

  if (statusResult.value.wsPort <= 0) {
    return Result.err(
      ValidationError.create(
        "signet.wsPort",
        "WebSocket transport must be enabled before adapter setup",
        {
          wsPort: statusResult.value.wsPort,
        },
      ),
    );
  }

  return Result.ok(statusResult.value);
}

/** Provision OpenClaw adapter artifacts plus operator/policy templates. */
export async function runOpenClawSetup(
  options: {
    readonly configPath: string;
    readonly force?: boolean | undefined;
  },
  deps: Partial<OpenClawSetupDeps> = {},
): Promise<Result<AdapterSetupResultType, SignetError>> {
  const resolvedDeps: OpenClawSetupDeps = { ...defaultDeps, ...deps };

  return resolvedDeps.withAdminClient(
    { configPath: options.configPath },
    async (
      client,
      context,
    ): Promise<Result<AdapterSetupResultType, SignetError>> => {
      const statusResult = await ensureSetupPrerequisites(client);
      if (statusResult.isErr()) {
        return statusResult;
      }

      const created: string[] = [];
      const reused: string[] = [];

      const operatorRecords: Record<string, OperatorRecordType> = {};
      for (const operatorTemplate of OPERATOR_TEMPLATES) {
        const result = await ensureOperator(client, operatorTemplate);
        if (result.isErr()) {
          return result;
        }
        operatorRecords[operatorTemplate.label] = result.value.record;
        (result.value.wasCreated ? created : reused).push(
          `operator:${operatorTemplate.label}`,
        );
      }

      const policyRecords: Record<string, PolicyRecordType> = {};
      for (const policyTemplate of POLICY_TEMPLATES) {
        const result = await ensurePolicy(client, policyTemplate);
        if (result.isErr()) {
          return result;
        }
        policyRecords[policyTemplate.label] = result.value.record;
        (result.value.wasCreated ? created : reused).push(
          `policy:${policyTemplate.label}`,
        );
      }

      const adapterDir = join(context.paths.dataDir, "adapters", "openclaw");
      const checkpointsDir = join(adapterDir, "checkpoints");
      await resolvedDeps.mkdir(checkpointsDir, { recursive: true });

      const operatorIds = Object.fromEntries(
        Object.entries(operatorRecords).map(([label, record]) => [
          label,
          record.id,
        ]),
      );
      const policyIds = Object.fromEntries(
        Object.entries(policyRecords).map(([label, record]) => [
          label,
          record.id,
        ]),
      );

      const openclawAccount = JSON.stringify(
        {
          adapter: OPENCLAW_ADAPTER_NAME,
          source: "builtin",
          signet: {
            configPath: options.configPath,
            dataDir: context.paths.dataDir,
            adminSocket: context.paths.adminSocket,
            wsPort: statusResult.value.wsPort,
          },
          operators: operatorIds,
          policies: policyIds,
        },
        null,
        2,
      );

      const operatorTemplatesJson = JSON.stringify(
        Object.fromEntries(
          OPERATOR_TEMPLATES.map((template) => [
            template.label,
            {
              ...template,
              operatorId: operatorRecords[template.label]?.id,
            },
          ]),
        ),
        null,
        2,
      );

      const policyTemplatesJson = JSON.stringify(
        Object.fromEntries(
          POLICY_TEMPLATES.map((template) => [
            template.label,
            {
              ...template,
              policyId: policyRecords[template.label]?.id,
            },
          ]),
        ),
        null,
        2,
      );

      const artifactWrites = [
        {
          label: "artifact:adapter.toml",
          path: join(adapterDir, "adapter.toml"),
          contents: renderAdapterToml({
            wsPort: statusResult.value.wsPort,
            operatorIds,
            policyIds,
            artifactDir: adapterDir,
          }),
        },
        {
          label: "artifact:adapter-manifest.toml",
          path: join(adapterDir, "adapter-manifest.toml"),
          contents: renderManifestToml(),
        },
        {
          label: "artifact:openclaw-account.json",
          path: join(adapterDir, "openclaw-account.json"),
          contents: openclawAccount,
        },
        {
          label: "artifact:operator-templates.json",
          path: join(adapterDir, "operator-templates.json"),
          contents: operatorTemplatesJson,
        },
        {
          label: "artifact:policy-templates.json",
          path: join(adapterDir, "policy-templates.json"),
          contents: policyTemplatesJson,
        },
      ] as const;

      const artifactMap: Record<string, string> = {};
      for (const artifact of artifactWrites) {
        const writeResult = await writeArtifact(resolvedDeps, {
          path: artifact.path,
          contents: artifact.contents,
          force: options.force === true,
        });
        artifactMap[artifact.label.replace("artifact:", "")] = artifact.path;
        (writeResult === "created" ? created : reused).push(artifact.label);
      }

      for (const artifactFile of listOpenClawArtifactFiles()) {
        if (!(artifactFile in artifactMap)) {
          return Result.err(
            InternalError.create("Missing expected adapter artifact mapping", {
              artifactFile,
            }),
          );
        }
      }

      const result = AdapterSetupResult.parse({
        adapter: OPENCLAW_ADAPTER_NAME,
        adapterSource: "builtin",
        status: "ok",
        created,
        reused,
        artifacts: artifactMap,
        nextSteps: [
          "Run `xs agent status openclaw --json` to verify the scaffolded adapter state.",
          "Wire OpenClaw to the generated adapter config under the signet data directory.",
        ],
      });

      return Result.ok(result);
    },
  );
}
