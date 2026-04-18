import { z } from "zod";

/** Adapter slug used in manifests, config, and CLI resolution. */
export const AdapterName: z.ZodType<string> = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]*$/,
    "Adapter names must start with a lowercase letter and contain only lowercase letters, digits, and hyphens",
  );

/** Inferred adapter slug type. */
export type AdapterNameType = z.infer<typeof AdapterName>;

/** Where an adapter implementation comes from. */
export const AdapterSource: z.ZodEnum<["builtin", "external"]> = z.enum([
  "builtin",
  "external",
]);

/** Inferred adapter source kind. */
export type AdapterSourceType = z.infer<typeof AdapterSource>;

/** Initial adapter verbs supported by the registry-backed CLI. */
export const AdapterVerb: z.ZodEnum<["setup", "status", "doctor"]> = z.enum([
  "setup",
  "status",
  "doctor",
]);

/** Inferred adapter verb type. */
export type AdapterVerbType = z.infer<typeof AdapterVerb>;

const AdapterEntrypointsShape = {
  setup: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  doctor: z.string().min(1).optional(),
} satisfies Record<AdapterVerbType, z.ZodOptional<z.ZodString>>;

/** Entrypoint map for supported adapter verbs. */
export const AdapterEntrypoints: z.ZodObject<{
  setup: z.ZodOptional<z.ZodString>;
  status: z.ZodOptional<z.ZodString>;
  doctor: z.ZodOptional<z.ZodString>;
}> = z.object(AdapterEntrypointsShape).strict();

/** Inferred adapter entrypoint map type. */
export type AdapterEntrypointsType = z.infer<typeof AdapterEntrypoints>;

/** Manifest that describes a built-in or adopted adapter to the registry. */
export const AdapterManifest: z.ZodType<{
  name: string;
  source: AdapterSourceType;
  supports: AdapterVerbType[];
  entrypoints: AdapterEntrypointsType;
}> = z
  .object({
    name: AdapterName,
    source: AdapterSource,
    supports: z.array(AdapterVerb).min(1),
    entrypoints: AdapterEntrypoints,
  })
  .strict()
  .superRefine((value, ctx) => {
    const supportedVerbs = new Set(value.supports);

    for (const verb of value.supports) {
      const entrypoint = value.entrypoints[verb];
      if (entrypoint === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entrypoints", verb],
          message: `Missing entrypoint for supported verb '${verb}'`,
        });
      }
    }

    for (const verb of AdapterVerb.options) {
      const entrypoint = value.entrypoints[verb];
      if (entrypoint !== undefined && !supportedVerbs.has(verb)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entrypoints", verb],
          message: `Entrypoint provided for unsupported verb '${verb}'`,
        });
      }
    }
  });

/** Inferred adapter manifest type. */
export type AdapterManifestType = z.infer<typeof AdapterManifest>;

/** Config block for a built-in adapter known to the repo. */
export const BuiltinAdapterConfig: z.ZodObject<{
  source: z.ZodLiteral<"builtin">;
}> = z
  .object({
    source: z.literal("builtin"),
  })
  .strict();

/** Inferred built-in adapter config type. */
export type BuiltinAdapterConfigType = z.infer<typeof BuiltinAdapterConfig>;

/** Config block for an adopted adapter outside the repo. */
export const ExternalAdapterConfig: z.ZodObject<{
  source: z.ZodLiteral<"external">;
  manifest: z.ZodString;
  command: z.ZodString;
}> = z
  .object({
    source: z.literal("external"),
    manifest: z.string().min(1),
    command: z.string().min(1),
  })
  .strict();

/** Inferred external adapter config type. */
export type ExternalAdapterConfigType = z.infer<typeof ExternalAdapterConfig>;

/** One adapter resolution entry in local CLI config. */
export const AgentAdapterConfig: z.ZodDiscriminatedUnion<
  "source",
  [typeof BuiltinAdapterConfig, typeof ExternalAdapterConfig]
> = z.discriminatedUnion("source", [
  BuiltinAdapterConfig,
  ExternalAdapterConfig,
]);

/** Inferred adapter resolution config type. */
export type AgentAdapterConfigType = z.infer<typeof AgentAdapterConfig>;

/** Mapping of adapter names to local registry resolution config. */
export const AgentAdaptersConfig: z.ZodDefault<
  z.ZodRecord<z.ZodString, typeof AgentAdapterConfig>
> = z.record(AgentAdapterConfig).default({});

/** Inferred mapping of adapter names to adapter config. */
export type AgentAdaptersConfigType = z.infer<typeof AgentAdaptersConfig>;

/** Shared status values for setup/status style adapter commands. */
export const AdapterCommandStatus: z.ZodEnum<["ok", "degraded", "missing"]> =
  z.enum(["ok", "degraded", "missing"]);

/** Inferred command status type. */
export type AdapterCommandStatusType = z.infer<typeof AdapterCommandStatus>;

/** Normalized result shape for adapter setup commands. */
export const AdapterSetupResult: z.ZodObject<{
  adapter: z.ZodType<string>;
  adapterSource: typeof AdapterSource;
  status: typeof AdapterCommandStatus;
  created: z.ZodDefault<z.ZodArray<z.ZodString>>;
  reused: z.ZodDefault<z.ZodArray<z.ZodString>>;
  artifacts: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
  nextSteps: z.ZodDefault<z.ZodArray<z.ZodString>>;
}> = z
  .object({
    adapter: AdapterName,
    adapterSource: AdapterSource,
    status: AdapterCommandStatus,
    created: z.array(z.string()).default([]),
    reused: z.array(z.string()).default([]),
    artifacts: z.record(z.string()).default({}),
    nextSteps: z.array(z.string()).default([]),
  })
  .strict();

/** Inferred adapter setup result type. */
export type AdapterSetupResultType = z.infer<typeof AdapterSetupResult>;

/** Normalized result shape for adapter status/doctor commands. */
export const AdapterStatusResult: z.ZodObject<{
  adapter: z.ZodType<string>;
  adapterSource: typeof AdapterSource;
  status: typeof AdapterCommandStatus;
  details: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}> = z
  .object({
    adapter: AdapterName,
    adapterSource: AdapterSource,
    status: AdapterCommandStatus,
    details: z.record(z.unknown()).default({}),
  })
  .strict();

/** Inferred adapter status result type. */
export type AdapterStatusResultType = z.infer<typeof AdapterStatusResult>;
