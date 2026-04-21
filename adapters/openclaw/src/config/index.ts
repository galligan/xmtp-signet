/** Canonical adapter slug for OpenClaw. */
export const OPENCLAW_ADAPTER_NAME = "openclaw";

/** Files the adapter will eventually generate under the signet data dir. */
export const OPENCLAW_ARTIFACT_FILES = [
  "adapter.toml",
  "adapter-manifest.toml",
  "openclaw-account.json",
  "operator-templates.json",
  "policy-templates.json",
] as const;
