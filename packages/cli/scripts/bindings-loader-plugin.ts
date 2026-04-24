import type { BunPlugin } from "bun";
import { readFileSync } from "node:fs";

/**
 * Patch `@xmtp/node-bindings/dist/index.js` at build time so its
 * `requireNative()` helper becomes a direct `require` of an absolute path
 * to the target-specific prebuilt `.node` file.
 *
 * Bun's napi loader then embeds exactly that one `.node` into the compiled
 * binary, avoiding the cross-target bloat of pulling in every prebuild.
 *
 * Throws if the upstream layout ever drifts — that's a signal the pinned
 * `@xmtp/node-bindings` version changed shape and the build needs review.
 */
export const bindingsLoader = (absoluteNodePath: string): BunPlugin => ({
  name: "patch-napi-loader",
  setup(build) {
    build.onLoad(
      { filter: /@xmtp[\\/]node-bindings[\\/]dist[\\/]index\.js$/ },
      (args) => {
        const src = readFileSync(args.path, "utf8");
        const patched = src.replace(
          /function requireNative\(\)\s*\{[\s\S]*?\n\}/,
          `function requireNative() { return require(${JSON.stringify(absoluteNodePath)}); }`,
        );
        if (patched === src) {
          throw new Error(
            "patch-napi-loader: requireNative() pattern not matched — @xmtp/node-bindings layout may have changed",
          );
        }
        return { contents: patched, loader: "js" };
      },
    );
  },
});
