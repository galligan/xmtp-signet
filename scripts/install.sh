#!/usr/bin/env bash

set -euo pipefail

UNAME="$(uname -s)"
DEFAULT_REPO_URL="https://github.com/galligan/xmtp-signet.git"
REF="${XMTP_SIGNET_REF:-main}"
LINK_BIN=1
UPDATE=0
BUN_CMD=""

default_install_dir() {
  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    printf '%s/xmtp-signet\n' "$XDG_DATA_HOME"
    return
  fi

  case "$UNAME" in
    Darwin)
      printf '%s/Library/Application Support/xmtp-signet\n' "$HOME"
      ;;
    *)
      printf '%s/.local/share/xmtp-signet\n' "$HOME"
      ;;
  esac
}

default_bin_dir() {
  if [[ -n "${XDG_BIN_HOME:-}" ]]; then
    printf '%s\n' "$XDG_BIN_HOME"
    return
  fi

  case "$UNAME" in
    Darwin)
      if [[ -d "$HOME/bin" && ! -d "$HOME/.local/bin" ]]; then
        printf '%s/bin\n' "$HOME"
      else
        printf '%s/.local/bin\n' "$HOME"
      fi
      ;;
    *)
      printf '%s/.local/bin\n' "$HOME"
      ;;
  esac
}

REPO_URL="${XMTP_SIGNET_REPO:-$DEFAULT_REPO_URL}"
INSTALL_DIR="${XMTP_SIGNET_INSTALL_DIR:-$(default_install_dir)}"
BIN_DIR="${XMTP_SIGNET_BIN_DIR:-$(default_bin_dir)}"

usage() {
  cat <<'EOF'
Install xmtp-signet from GitHub into a local checkout and create an `xs` wrapper.

Usage:
  install.sh [options]

Options:
  --dir <path>       Install checkout path (default: XDG-aware per-platform path)
  --bin-dir <path>   Wrapper install path (default: XDG-aware per-platform path)
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
  XDG_DATA_HOME
  XDG_BIN_HOME
EOF
  printf '\nDefault paths:\n'
  printf '  checkout -> %s\n' "$INSTALL_DIR"
  printf '  wrappers -> %s\n' "$BIN_DIR"
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

resolve_expected_bun_version() {
  local version_file="$INSTALL_DIR/.bun-version"
  if [[ ! -f "$version_file" ]]; then
    echo "missing Bun version pin: $version_file" >&2
    exit 1
  fi

  tr -d '[:space:]' < "$version_file"
}

install_bun_version() {
  local expected="$1"
  local bun_install_root="${BUN_INSTALL:-$HOME/.bun}"

  require_tool curl "Install curl first, then re-run this installer."

  echo "==> Installing Bun $expected"
  env BUN_INSTALL="$bun_install_root" bash -c \
    "$(curl -fsSL https://bun.sh/install)" -- "bun-v$expected"

  export BUN_INSTALL="$bun_install_root"
  export PATH="$BUN_INSTALL/bin:$PATH"
  hash -r
}

ensure_bun_runtime() {
  local expected current
  expected="$(resolve_expected_bun_version)"

  if command -v bun >/dev/null 2>&1; then
    current="$(bun --version)"
  else
    current=""
  fi

  if [[ "$current" != "$expected" ]]; then
    if [[ -z "$current" ]]; then
      echo "==> Bun $expected is required and not installed"
    else
      echo "==> Replacing Bun $current with pinned version $expected"
    fi
    install_bun_version "$expected"
  fi

  if ! command -v bun >/dev/null 2>&1; then
    echo "bun is still unavailable after installation" >&2
    exit 1
  fi

  current="$(bun --version)"
  if [[ "$current" != "$expected" ]]; then
    echo "installed Bun version mismatch: expected $expected, found $current" >&2
    exit 1
  fi

  BUN_CMD="$(command -v bun)"
}

write_wrapper() {
  local name="$1"
  local wrapper_path="$BIN_DIR/$name"
  cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL_DIR"
exec "$BUN_CMD" packages/cli/src/bin.ts "\$@"
EOF
  chmod +x "$wrapper_path"
}

ensure_checkout
ensure_bun_runtime

echo "==> Bootstrapping checkout"
(
  cd "$INSTALL_DIR"
  "$BUN_CMD" run bootstrap
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
echo "  xs agent setup openclaw   # if this machine is for OpenClaw"

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
