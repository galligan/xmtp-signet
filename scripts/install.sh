#!/usr/bin/env bash

set -euo pipefail

UNAME="$(uname -s)"
DEFAULT_REPO_URL="https://github.com/galligan/xmtp-signet.git"
DEFAULT_RELEASE_REPO="galligan/xmtp-signet"
REF="${XMTP_SIGNET_REF:-main}"
LINK_BIN=1
UPDATE=0
BINARY=1
BINARY_EXPLICIT=0
SOURCE_EXPLICIT=0
RELEASE="${XMTP_SIGNET_RELEASE:-latest}"
RELEASE_EXPLICIT=0
REF_EXPLICIT=0
REPO_EXPLICIT=0

default_install_dir() {
  if [[ -n "${XDG_DATA_HOME:-}" ]]; then
    printf '%s/xmtp-signet/install\n' "$XDG_DATA_HOME"
    return
  fi

  case "$UNAME" in
    Darwin)
      printf '%s/Library/Application Support/xmtp-signet/install\n' "$HOME"
      ;;
    *)
      printf '%s/.local/share/xmtp-signet/install\n' "$HOME"
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
Install xmtp-signet and create an `xs` wrapper.

Two install modes:
  binary (default) — download a prebuilt single-file binary from GitHub Releases
  source (--source) — clone the repo and bootstrap with Bun

Usage:
  install.sh [options]

Options:
  --binary           Install a prebuilt binary from GitHub Releases. This is the
                     default mode and skips Bun + git requirements.
  --source           Clone the repo and bootstrap with Bun instead of installing
                     a prebuilt binary.
  --release <tag>    Release tag to download in binary mode (default: latest)
  --dir <path>       Install path (default: XDG-aware per-platform path)
  --bin-dir <path>   Wrapper install path (default: XDG-aware per-platform path)
  --repo <url>       (source mode) Git repository to clone (default: official GitHub repo)
  --ref <name>       (source mode) Git branch, tag, or ref to clone (default: main)
  --update           Refresh an existing install (fast-forward or redownload)
  --no-link-bin      Skip creating xs/xmtp-signet wrapper scripts
  -h, --help         Show this help

Binary mode supports: darwin-arm64, linux-x64, linux-arm64. Other platforms can
use source mode with --source.

Once `xs` is on PATH, see the xmtp-admin skill for next steps:
  .plugins/xmtp-signet/skills/xmtp-admin/SKILL.md

Environment overrides:
  XMTP_SIGNET_INSTALL_DIR
  XMTP_SIGNET_BIN_DIR
  XMTP_SIGNET_REPO
  XMTP_SIGNET_REF
  XMTP_SIGNET_RELEASE
  XDG_DATA_HOME
  XDG_BIN_HOME
EOF
  printf '\nDefault paths:\n'
  printf '  install  -> %s\n' "$INSTALL_DIR"
  printf '  wrappers -> %s\n' "$BIN_DIR"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --binary)
      BINARY=1
      BINARY_EXPLICIT=1
      shift
      ;;
    --source)
      BINARY=0
      SOURCE_EXPLICIT=1
      shift
      ;;
    --release)
      RELEASE="$2"
      RELEASE_EXPLICIT=1
      shift 2
      ;;
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
      REPO_EXPLICIT=1
      if [[ "$BINARY_EXPLICIT" != "1" ]]; then
        BINARY=0
      fi
      shift 2
      ;;
    --ref)
      REF="$2"
      REF_EXPLICIT=1
      if [[ "$BINARY_EXPLICIT" != "1" ]]; then
        BINARY=0
      fi
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

if [[ "$BINARY_EXPLICIT" == "1" && "$SOURCE_EXPLICIT" == "1" ]]; then
  echo "--binary and --source select different install modes; choose one." >&2
  exit 1
fi

if [[ "$BINARY" == "1" ]]; then
  if [[ "$REF_EXPLICIT" == "1" ]]; then
    echo "--ref is a source-install option; it cannot be combined with --binary." >&2
    echo "Use --release <tag> to pin a binary version." >&2
    exit 1
  fi
  if [[ "$REPO_EXPLICIT" == "1" ]]; then
    echo "--repo is a source-install option; it cannot be combined with --binary." >&2
    echo "Binary downloads always come from the official release at github.com/$DEFAULT_RELEASE_REPO." >&2
    exit 1
  fi
elif [[ "$RELEASE_EXPLICIT" == "1" ]]; then
  echo "--release is a binary-install option; it cannot be combined with --source." >&2
  exit 1
fi

require_tool() {
  local tool="$1"
  local hint="$2"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing required tool: $tool" >&2
    echo "$hint" >&2
    exit 1
  fi
}

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

# --- Binary install helpers ---------------------------------------------------

TARGET=""
TMP_DIR=""

cleanup_tmp() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf "$TMP_DIR"
  fi
}

detect_target() {
  case "$(uname -sm)" in
    "Darwin arm64")
      TARGET="darwin-arm64"
      ;;
    "Linux x86_64")
      TARGET="linux-x64"
      ;;
    "Linux aarch64"|"Linux arm64")
      TARGET="linux-arm64"
      ;;
    *)
      echo "Binary install is not available for: $(uname -sm)" >&2
      echo "Supported targets: darwin-arm64, linux-x64, linux-arm64." >&2
      echo "Use source install with --source." >&2
      exit 1
      ;;
  esac
}

resolve_release_urls() {
  local base
  if [[ "$RELEASE" == "latest" ]]; then
    base="https://github.com/$DEFAULT_RELEASE_REPO/releases/latest/download"
  else
    base="https://github.com/$DEFAULT_RELEASE_REPO/releases/download/$RELEASE"
  fi
  TARBALL_NAME="xs-$TARGET.tar.gz"
  TARBALL_URL="$base/$TARBALL_NAME"
  CHECKSUM_URL="$TARBALL_URL.sha256"
}

sha_verify() {
  # Usage: sha_verify <sha256-file> <target-file-basename>
  # Runs in the cwd of the files.
  local sha_file="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$sha_file"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$sha_file"
  else
    echo "missing required tool: shasum or sha256sum" >&2
    echo "Install coreutils (Linux) or Perl's shasum (macOS), then re-run." >&2
    exit 1
  fi
}

ensure_binary() {
  detect_target
  resolve_release_urls

  if [[ -e "$INSTALL_DIR" ]]; then
    if [[ "$UPDATE" == "1" ]]; then
      echo "==> Removing existing install at $INSTALL_DIR (--update)"
      rm -rf "$INSTALL_DIR"
    elif [[ -d "$INSTALL_DIR/.git" ]]; then
      echo "install directory is an existing source checkout: $INSTALL_DIR" >&2
      echo "Refusing to overwrite with a binary install. Choose a different --dir," >&2
      echo "or remove that directory first, or re-run with --source." >&2
      exit 1
    elif [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
      echo "install directory is not empty: $INSTALL_DIR" >&2
      echo "Re-run with --update to replace it, or pick a different --dir." >&2
      exit 1
    fi
  fi

  TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t xmtp-signet)"
  trap cleanup_tmp EXIT

  echo "==> Downloading $TARBALL_NAME (release: $RELEASE)"
  echo "    $TARBALL_URL"
  if ! curl -fsSL --retry 3 -o "$TMP_DIR/$TARBALL_NAME" "$TARBALL_URL"; then
    echo >&2
    echo "Failed to download $TARBALL_URL" >&2
    echo "Check that release '$RELEASE' exists for target '$TARGET' at:" >&2
    echo "  https://github.com/$DEFAULT_RELEASE_REPO/releases" >&2
    exit 1
  fi

  echo "==> Downloading checksum"
  if ! curl -fsSL --retry 3 -o "$TMP_DIR/$TARBALL_NAME.sha256" "$CHECKSUM_URL"; then
    echo >&2
    echo "Failed to download $CHECKSUM_URL" >&2
    echo "The release artifact exists but its .sha256 file is missing." >&2
    exit 1
  fi

  echo "==> Verifying checksum"
  (
    cd "$TMP_DIR"
    sha_verify "$TARBALL_NAME.sha256"
  ) || {
    echo "checksum verification failed for $TARBALL_NAME" >&2
    exit 1
  }

  mkdir -p "$INSTALL_DIR"
  echo "==> Extracting into $INSTALL_DIR"
  tar -xzf "$TMP_DIR/$TARBALL_NAME" -C "$INSTALL_DIR"

  local binary_path="$INSTALL_DIR/xs-$TARGET"
  if [[ ! -f "$binary_path" ]]; then
    echo "expected binary not found after extraction: $binary_path" >&2
    echo "The release tarball appears to be malformed." >&2
    exit 1
  fi
  chmod +x "$binary_path"

  if [[ "$TARGET" == "darwin-arm64" && -f "$INSTALL_DIR/signet-signer" ]]; then
    chmod +x "$INSTALL_DIR/signet-signer"
  fi
}

write_binary_wrapper() {
  local name="$1"
  local wrapper_path="$BIN_DIR/$name"
  cat > "$wrapper_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
# Absolute path preserves the caller's CWD so relative --config / file
# arguments resolve against the user's directory.
exec "$INSTALL_DIR/xs-$TARGET" "\$@"
EOF
  chmod +x "$wrapper_path"
}

print_binary_metadata() {
  local meta="$INSTALL_DIR/xs-$TARGET.json"
  if [[ ! -f "$meta" ]]; then
    return
  fi
  local version commit built
  version="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$meta" | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
  commit="$(grep -o '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' "$meta" | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
  built="$(grep -o '"builtAt"[[:space:]]*:[[:space:]]*"[^"]*"' "$meta" | head -n1 | sed 's/.*"\([^"]*\)"$/\1/')"
  if [[ -n "$version" || -n "$commit" ]]; then
    printf 'Version: %s' "${version:-unknown}"
    if [[ -n "$commit" ]]; then
      printf ' (%s)' "$commit"
    fi
    if [[ -n "$built" ]]; then
      printf ' built %s' "$built"
    fi
    printf '\n'
    printf 'Target:  %s\n' "$TARGET"
  fi
}

# --- Main ---------------------------------------------------------------------

if [[ "$BINARY" == "1" ]]; then
  require_tool curl "Install curl, then re-run this installer."
  require_tool tar "Install tar, then re-run this installer."
  ensure_binary
else
  require_tool git "Install Git first, then re-run this installer."
  require_tool bun "Install Bun from https://bun.sh, then re-run this installer."
  ensure_checkout
  warn_on_bun_version_mismatch

  echo "==> Bootstrapping checkout"
  (
    cd "$INSTALL_DIR"
    bun run bootstrap
  )
fi

if [[ "$LINK_BIN" == "1" ]]; then
  echo "==> Installing xs wrapper into $BIN_DIR"
  mkdir -p "$BIN_DIR"
  if [[ "$BINARY" == "1" ]]; then
    write_binary_wrapper xs
    write_binary_wrapper xmtp-signet
  else
    write_wrapper xs
    write_wrapper xmtp-signet
  fi
fi

echo
echo "xmtp-signet is ready."
echo "Install: $INSTALL_DIR"
if [[ "$BINARY" == "1" ]]; then
  print_binary_metadata
fi
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
