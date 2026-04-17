import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import type { CliConfig } from "./schema.js";

/**
 * Persist a parsed CLI config as TOML, creating the parent directory when
 * needed so first-run `xs init` can materialize the recommended setup.
 */
export async function writeConfig(
  configPath: string,
  config: CliConfig,
): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, stringifyToml(config) + "\n", "utf8");
}
