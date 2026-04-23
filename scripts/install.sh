#!/usr/bin/env bash

set -euo pipefail

REPO_URL="${XMTP_SIGNET_REPO:-https://github.com/xmtp/xmtp-signet.git}"
REF="${XMTP_SIGNET_REF:-main}"
INSTALL_DIR="${XMTP_SIGNET_INSTALL_DIR:-$HOME/.local/share/xmtp-signet}"
BIN_DIR="${XMTP_SIGNET_BIN_DIR:-$HOME/.local/bin}"
LINK_BIN=1
UPDATE=0

usage() {
  cat <<'EOF'
Install xmtp-signet from GitHub into a local checkout and create an `xs` wrapper.

Usage:
  install.sh [options]

Options:
  --dir <path>       Install checkout path (default: ~/.local/share/xmtp-signet)
  --bin-dir <path>   Wrapper install path (default: ~/.local/bin)
  --repo <url>       Git repository to clone (default: official GitHub repo)
  --ref <name>       Git branch, tag, or ref to clone (default: main)
  --update           Fetch and fast-forward an existing checkout before bootstrap
  --no-link-bin      Skip creating xs/xmtp-signet wrapper scripts
  -h, --help         Show this help

Environment overrides:
  XMTP_SIGNET_INSTALL_DIR
  XMTP_SIGNET_BIN_DIR
  XMTP_SIGNET_REPO
  XMTP_SIGNET_REF
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    --repo)
      REPO_URL="$2"
      shift 2
      ;;
    --ref)
      REF="$2"
      shift 2
      ;;
    --update)
      UPDATE=1
      shift
      ;;
    --no-link-bin)
      LINK_BIN=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_tool() {
  local tool="$1"
  local hint="$2"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    echo "$hint" >&2
    exit 1
  fi
}

require_tool git "Install Git first, then re-run this installer."
require_tool bun "Install Bun from https://bun.sh, then re-run this installer."

ensure_checkout() {
  if [[ ! -e "$INSTALL_DIR" ]]; then
    mkdir -p "$(dirname "$INSTALL_DIR")"
    echo "==> Cloning xmtp-signet into $INSTALL_DIR"
    git clone --branch "$REF" --single-branch "$REPO_URL" "$INSTALL_DIR"
    return
  fi

  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    echo "install directory exists but is not a git checkout: $INSTALL_DIR" >&2
    echo "Choose a different --dir or remove that directory first." >&2
    exit 1
  fi

  echo "==> Reusing existing checkout at $INSTALL_DIR"
  if [[ "$UPDATE" == "1" ]]; then
    echo "==> Updating checkout to $REF"
    (
      cd "$INSTALL_DIR"
      git fetch origin "$REF"
      git checkout "$REF"
      if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then
        git pull --ff-only origin "$REF"
      else
        echo "==> Checked out non-branch ref $REF; skipping fast-forward pull"
      fi
    )
  fi
}

warn_on_bun_version_mismatch() {
  local version_file="$INSTALL_DIR/.bun-version"
  if [[ -f "$version_file" ]]; then
    local expected current
    expected="$(< "$version_file")"
    current="$(bun --version)"
    if [[ "$current" != "$expected" ]]; then
      echo "warning: expected Bun $expected, found $current" >&2
    fi
  fi
}

write_wrapper() {
  local name="$1"
  local wrapper_path="$BIN_DIR/$name"
  cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL_DIR"
exec bun packages/cli/src/bin.ts "\$@"
EOF
  chmod +x "$wrapper_path"
}

ensure_checkout
warn_on_bun_version_mismatch

echo "==> Bootstrapping checkout"
(
  cd "$INSTALL_DIR"
  bun run bootstrap
)

if [[ "$LINK_BIN" == "1" ]]; then
  echo "==> Installing xs wrapper into $BIN_DIR"
  mkdir -p "$BIN_DIR"
  write_wrapper xs
  write_wrapper xmtp-signet
fi

echo
echo "xmtp-signet is ready."
echo "Checkout: $INSTALL_DIR"
if [[ "$LINK_BIN" == "1" ]]; then
  echo "Wrappers: $BIN_DIR/xs and $BIN_DIR/xmtp-signet"
fi
echo
echo "Next steps:"
echo "  xs --help"
echo "  xs init --env dev --label owner"
echo "  xs daemon start"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    ;;
  *)
    if [[ "$LINK_BIN" == "1" ]]; then
      echo
      echo "If \`xs\` is not found in a new shell, add this to your shell profile:"
      echo "  export PATH=\"$BIN_DIR:\$PATH\""
    fi
    ;;
esac
