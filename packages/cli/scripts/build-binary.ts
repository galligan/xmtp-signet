#!/usr/bin/env bun
/**
 * Build a single-file `xs` binary via `bun build --compile` for a given
 * target. Patches `@xmtp/node-bindings` so only one prebuilt `.node` gets
 * embedded, then (on macOS arm64) strips the placeholder signature and
 * re-signs ad-hoc with JIT entitlements so the binary will actually run.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bindingsLoader } from "./bindings-loader-plugin.ts";

type SupportedTarget =
  | "bun-darwin-arm64"
  | "bun-linux-x64"
  | "bun-linux-arm64";

const SUPPORTED_TARGETS: readonly SupportedTarget[] = [
  "bun-darwin-arm64",
  "bun-linux-x64",
  "bun-linux-arm64",
];

const NODE_FILE_BY_TARGET: Record<SupportedTarget, string> = {
  "bun-darwin-arm64": "bindings_node.darwin-arm64.node",
  "bun-linux-x64": "bindings_node.linux-x64-gnu.node",
  "bun-linux-arm64": "bindings_node.linux-arm64-gnu.node",
};

const SHORT_NAME_BY_TARGET: Record<SupportedTarget, string> = {
  "bun-darwin-arm64": "darwin-arm64",
  "bun-linux-x64": "linux-x64",
  "bun-linux-arm64": "linux-arm64",
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function die(msg: string): never {
  console.error(`build-binary: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): {
  target: SupportedTarget;
  outputDir: string;
  version: string | undefined;
  skipCodesign: boolean;
} {
  let target: string | undefined;
  let outputDir: string | undefined;
  let version: string | undefined;
  let skipCodesign = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--target":
        target = argv[++i];
        break;
      case "--output-dir":
        outputDir = argv[++i];
        break;
      case "--version":
        version = argv[++i];
        break;
      case "--skip-codesign":
        skipCodesign = true;
        break;
      default:
        die(`unknown argument: ${arg}`);
    }
  }

  if (!target) die("--target is required");
  if (!SUPPORTED_TARGETS.includes(target as SupportedTarget)) {
    die(
      `unsupported target: ${target} (expected one of ${SUPPORTED_TARGETS.join(", ")})`,
    );
  }

  return {
    target: target as SupportedTarget,
    outputDir: resolve(outputDir ?? join(repoRoot, "packages/cli/dist")),
    version,
    skipCodesign,
  };
}

function readCliVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, "packages/cli/package.json"), "utf8"),
  ) as { version?: string };
  if (!pkg.version) die("packages/cli/package.json has no version");
  return pkg.version;
}

/**
 * Locate the prebuilt `.node` file for a target by walking the Bun install
 * store. Transitive deps live under `.bun/<name>@<version>/node_modules/...`
 * so we prefer the highest version of `@xmtp/node-bindings` available.
 */
function resolveNodeBindingFile(target: SupportedTarget): string {
  const storeDir = join(repoRoot, "node_modules/.bun");
  const entries = readdirSync(storeDir).filter((e) =>
    e.startsWith("@xmtp+node-bindings@"),
  );
  if (entries.length === 0) {
    die(
      "no @xmtp/node-bindings install found under node_modules/.bun — run bun install",
    );
  }
  // Lexicographic sort is fine for same-major semver here (1.8 < 1.10 would
  // bite but both present versions are 1.x; sort by parsed version to be safe).
  entries.sort((a, b) => {
    const va = a.replace("@xmtp+node-bindings@", "").split(".").map(Number);
    const vb = b.replace("@xmtp+node-bindings@", "").split(".").map(Number);
    for (let i = 0; i < Math.max(va.length, vb.length); i++) {
      const diff = (vb[i] ?? 0) - (va[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });

  const fileName = NODE_FILE_BY_TARGET[target];
  for (const entry of entries) {
    const candidate = join(
      storeDir,
      entry,
      "node_modules/@xmtp/node-bindings/dist",
      fileName,
    );
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not in this version, try next */
    }
  }
  die(`could not locate ${fileName} in any @xmtp/node-bindings install`);
}

async function sha256Hex(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).bytes());
  return hasher.digest("hex");
}

async function main(): Promise<void> {
  const { target, outputDir, version: versionOverride, skipCodesign } =
    parseArgs(process.argv.slice(2));
  const version = versionOverride ?? readCliVersion();

  const absNodePath = resolveNodeBindingFile(target);
  const shortName = SHORT_NAME_BY_TARGET[target];
  const outfile = join(outputDir, `xs-${shortName}`);
  const metaPath = join(outputDir, `xs-${shortName}.json`);

  const commit = (await Bun.$`git rev-parse --short HEAD`.cwd(repoRoot).text())
    .trim();
  const builtAt = new Date().toISOString();

  console.log(`build-binary: target=${target} version=${version} commit=${commit}`);
  console.log(`build-binary: embedding ${basename(absNodePath)}`);
  console.log(`build-binary: outfile=${outfile}`);

  const result = await Bun.build({
    entrypoints: [join(repoRoot, "packages/cli/src/bin.ts")],
    compile: { target, outfile },
    minify: true,
    sourcemap: "linked",
    // bytecode: false — deferred; spike didn't validate bytecode with this codebase.
    define: {
      BUILD_VERSION: JSON.stringify(version),
      BUILD_COMMIT: JSON.stringify(commit),
      BUILD_TIME: JSON.stringify(builtAt),
    },
    plugins: [bindingsLoader(absNodePath)],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    die("Bun.build failed");
  }

  if (target === "bun-darwin-arm64" && !skipCodesign) {
    const entitlements = join(scriptDir, "entitlements.plist");
    console.log("build-binary: stripping placeholder signature");
    // Placeholder may or may not be strippable — don't fail if codesign complains.
    await Bun.$`codesign --remove-signature ${outfile}`.nothrow().quiet();
    console.log("build-binary: ad-hoc signing with JIT entitlements");
    const signResult =
      await Bun.$`codesign --sign - --force --entitlements ${entitlements} ${outfile}`.nothrow();
    if (signResult.exitCode !== 0) {
      console.error(signResult.stderr.toString());
      die("codesign --sign failed");
    }
  }

  const size = statSync(outfile).size;
  const sha256 = await sha256Hex(outfile);

  await Bun.write(
    metaPath,
    JSON.stringify(
      {
        version,
        commit,
        builtAt,
        target,
        size,
        sha256,
        plugin: "patch-napi-loader",
      },
      null,
      2,
    ) + "\n",
  );

  const mb = (size / 1024 / 1024).toFixed(1);
  console.log(`build-binary: built ${outfile} (${mb}MB)`);
}

await main();
