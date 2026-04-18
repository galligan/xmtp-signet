import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { Result } from "better-result";
import { parse as parseToml } from "smol-toml";
import {
  AdapterManifest,
  type AdapterManifestType,
  type AdapterVerbType,
  InternalError,
  NotFoundError,
  ValidationError,
  type SignetError,
} from "@xmtp/signet-schemas";
import type { CliConfig } from "../config/schema.js";
import {
  getBuiltinAgentAdapters,
  type BuiltinAgentAdapterDefinition,
  type BuiltinAgentAdapterRegistry,
} from "./builtin-registry.js";

/** Resolved adapter command that the generic CLI can execute. */
export interface ResolvedAgentAdapterCommand {
  readonly adapterName: string;
  readonly verb: AdapterVerbType;
  readonly manifest: AdapterManifestType;
  readonly source: "builtin" | "external";
  readonly command: string;
  readonly cwd?: string | undefined;
}

/** Dependencies for adapter resolution. */
export interface ResolveAgentAdapterDeps {
  readonly readFile: typeof readFile;
  readonly builtinRegistry: BuiltinAgentAdapterRegistry;
}

const defaultDeps: ResolveAgentAdapterDeps = {
  readFile,
  builtinRegistry: getBuiltinAgentAdapters(),
};

function resolveAgainstConfigPath(configPath: string, target: string): string {
  if (isAbsolute(target)) {
    return target;
  }

  return resolvePath(dirname(configPath), target);
}

async function loadExternalManifest(
  deps: ResolveAgentAdapterDeps,
  options: {
    readonly adapterName: string;
    readonly configPath: string;
    readonly manifestPath: string;
  },
): Promise<Result<AdapterManifestType, SignetError>> {
  const resolvedManifestPath = resolveAgainstConfigPath(
    options.configPath,
    options.manifestPath,
  );

  let manifestSource: string;
  try {
    manifestSource = await deps.readFile(resolvedManifestPath, "utf-8");
  } catch (error) {
    return Result.err(
      InternalError.create("Failed to read adapter manifest", {
        adapter: options.adapterName,
        manifestPath: resolvedManifestPath,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  let rawManifest: unknown;
  try {
    rawManifest = parseToml(manifestSource);
  } catch (error) {
    return Result.err(
      ValidationError.create(
        "manifest",
        `Invalid adapter manifest TOML: ${String(error)}`,
        {
          adapter: options.adapterName,
          manifestPath: resolvedManifestPath,
        },
      ),
    );
  }

  const manifestResult = AdapterManifest.safeParse(rawManifest);
  if (!manifestResult.success) {
    return Result.err(
      ValidationError.create(
        "manifest",
        manifestResult.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
        {
          adapter: options.adapterName,
          manifestPath: resolvedManifestPath,
        },
      ),
    );
  }

  const manifest = manifestResult.data;
  if (manifest.name !== options.adapterName) {
    return Result.err(
      ValidationError.create(
        "manifest.name",
        `Manifest name '${manifest.name}' does not match requested adapter '${options.adapterName}'`,
        {
          adapter: options.adapterName,
          manifestPath: resolvedManifestPath,
          manifestName: manifest.name,
        },
      ),
    );
  }

  if (manifest.source !== "external") {
    return Result.err(
      ValidationError.create(
        "manifest.source",
        `External adapter manifest must declare source 'external'`,
        {
          adapter: options.adapterName,
          manifestPath: resolvedManifestPath,
          manifestSource: manifest.source,
        },
      ),
    );
  }

  return Result.ok(manifest);
}

function validateManifestVerb(
  adapterName: string,
  verb: AdapterVerbType,
  manifest: AdapterManifestType,
): Result<void, ValidationError> {
  if (!manifest.supports.includes(verb)) {
    return Result.err(
      ValidationError.create(
        "verb",
        `Adapter '${adapterName}' does not support '${verb}'`,
        {
          adapter: adapterName,
          verb,
          supportedVerbs: manifest.supports,
        },
      ),
    );
  }

  const entrypoint = manifest.entrypoints[verb];
  if (entrypoint === undefined) {
    return Result.err(
      ValidationError.create(
        "entrypoints",
        `Adapter '${adapterName}' is missing an entrypoint for '${verb}'`,
        {
          adapter: adapterName,
          verb,
        },
      ),
    );
  }

  return Result.ok(undefined);
}

function resolveBuiltinAdapter(
  adapterName: string,
  verb: AdapterVerbType,
  builtin: BuiltinAgentAdapterDefinition | undefined,
): Result<ResolvedAgentAdapterCommand, SignetError> {
  if (builtin === undefined) {
    return Result.err(NotFoundError.create("adapter", adapterName));
  }

  const supportResult = validateManifestVerb(
    adapterName,
    verb,
    builtin.manifest,
  );
  if (supportResult.isErr()) {
    return supportResult;
  }

  return Result.ok({
    adapterName,
    verb,
    manifest: builtin.manifest,
    source: "builtin",
    command: builtin.command,
    ...(builtin.cwd !== undefined ? { cwd: builtin.cwd } : {}),
  });
}

/** Resolve a requested adapter to a process-backed command. */
export async function resolveAgentAdapterCommand(
  options: {
    readonly adapterName: string;
    readonly verb: AdapterVerbType;
    readonly config: CliConfig;
    readonly configPath: string;
  },
  deps: Partial<ResolveAgentAdapterDeps> = {},
): Promise<Result<ResolvedAgentAdapterCommand, SignetError>> {
  const resolvedDeps: ResolveAgentAdapterDeps = {
    ...defaultDeps,
    builtinRegistry: deps.builtinRegistry ?? getBuiltinAgentAdapters(),
    ...deps,
  };
  const configuredAdapter = options.config.agent.adapters[options.adapterName];

  if (configuredAdapter?.source === "external") {
    const manifestResult = await loadExternalManifest(resolvedDeps, {
      adapterName: options.adapterName,
      configPath: options.configPath,
      manifestPath: configuredAdapter.manifest,
    });
    if (manifestResult.isErr()) {
      return manifestResult;
    }

    const supportResult = validateManifestVerb(
      options.adapterName,
      options.verb,
      manifestResult.value,
    );
    if (supportResult.isErr()) {
      return supportResult;
    }

    return Result.ok({
      adapterName: options.adapterName,
      verb: options.verb,
      manifest: manifestResult.value,
      source: "external",
      command: resolveAgainstConfigPath(
        options.configPath,
        configuredAdapter.command,
      ),
    });
  }

  const builtin = resolvedDeps.builtinRegistry[options.adapterName];
  if (builtin !== undefined) {
    return resolveBuiltinAdapter(options.adapterName, options.verb, builtin);
  }

  if (configuredAdapter?.source === "builtin") {
    return Result.err(
      NotFoundError.create("built-in adapter", options.adapterName),
    );
  }

  return Result.err(NotFoundError.create("adapter", options.adapterName));
}
