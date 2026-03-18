#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to bootstrap this repo." >&2
  exit 1
fi

EXPECTED_BUN_VERSION="$(< .bun-version)"
CURRENT_BUN_VERSION="$(bun --version)"

echo "==> Bootstrapping xmtp-signet"

if [[ "$CURRENT_BUN_VERSION" != "$EXPECTED_BUN_VERSION" ]]; then
  echo "warning: expected Bun $EXPECTED_BUN_VERSION, found $CURRENT_BUN_VERSION" >&2
fi

echo "==> Installing workspace dependencies"
bun install --frozen-lockfile

if git rev-parse --git-dir >/dev/null 2>&1; then
  echo "==> Installing git hooks"
  bunx lefthook install
fi

echo "==> Verifying local toolchain"
for tool in turbo oxlint oxfmt; do
  if [[ ! -x "./node_modules/.bin/$tool" ]]; then
    echo "missing expected tool after install: $tool" >&2
    exit 1
  fi
done

# Build signet-signer (macOS only, optional)
if [[ "$(uname)" == "Darwin" ]]; then
  echo "==> Checking Swift toolchain"
  if command -v swift >/dev/null 2>&1; then
    echo "  Swift $(swift --version 2>&1 | head -1)"
    echo "==> Building signet-signer"
    (cd signet-signer && swift build -c release --quiet)
    echo "  Built: signet-signer/.build/release/signet-signer"
  else
    echo "  Swift not found — Secure Enclave support unavailable"
    echo "  Install Xcode Command Line Tools: xcode-select --install"
  fi
fi

echo "==> Bootstrap complete"
echo "Next steps:"
echo "  bun run format:check"
echo "  bun run lint"
echo "  bun run typecheck"
echo "  bun run test"
