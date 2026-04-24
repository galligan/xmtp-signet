/**
 * Build-time metadata injected via `bun build --define` when compiling
 * a standalone binary. When the CLI is run from source (e.g.
 * `bun packages/cli/src/bin.ts`), the globals are undefined and we
 * report `dev` fallbacks.
 *
 * @module
 */

declare const BUILD_VERSION: string;
declare const BUILD_COMMIT: string;
declare const BUILD_TIME: string;

function readGlobal(name: "version" | "commit" | "builtAt"): string {
  try {
    switch (name) {
      case "version":
        return typeof BUILD_VERSION === "string" ? BUILD_VERSION : "dev";
      case "commit":
        return typeof BUILD_COMMIT === "string" ? BUILD_COMMIT : "dev";
      case "builtAt":
        return typeof BUILD_TIME === "string" ? BUILD_TIME : "dev";
    }
  } catch {
    return "dev";
  }
}

/** Build-time metadata for this CLI binary. */
export const buildInfo: {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
} = {
  version: readGlobal("version"),
  commit: readGlobal("commit"),
  builtAt: readGlobal("builtAt"),
};

/**
 * Format a single-line version string for `xs --version`. Omits commit
 * and build time when running from source.
 */
export function formatVersion(): string {
  if (buildInfo.commit === "dev") {
    return `${buildInfo.version} (dev)`;
  }
  return `${buildInfo.version} (${buildInfo.commit}) built ${buildInfo.builtAt}`;
}
