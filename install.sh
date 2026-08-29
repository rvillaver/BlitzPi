#!/bin/sh
# BlitzPi installer / updater / uninstaller — macOS + Linux, POSIX sh, no dependencies beyond curl, tar, unzip.
#
#   Install:    curl -fsSL https://raw.githubusercontent.com/rvillaver/BlitzPi/master/install.sh | sh
#   Update:     blitzpi update        (runs this script with --update)
#   Uninstall:  blitzpi uninstall     (runs this script with --uninstall)
#
# Everything BlitzPi needs — a private Bun runtime, Pi, and every bundled package — is installed
# into ONE app directory, chosen per operating system (mirror of src/paths.ts):
#
#   macOS   app: ~/Library/Application Support/BlitzPi     command: ~/.local/bin/blitzpi
#   Linux   app: $XDG_DATA_HOME/blitzpi (~/.local/share)   command: ~/.local/bin/blitzpi
#
# Layout:  <app>/bun/bin/bun   <app>/versions/<version>/   <app>/current -> versions/<version>
# Updates install the next release as a whole into a new versions/<version> and switch `current`
# atomically; the previous version is kept for rollback. Nothing is installed system-wide.
#
# Options:  --update  --uninstall  --yes  --version vX.Y.Z  --print-paths
# Env:      BLITZPI_HOME (app dir override), BLITZPI_SOURCE (local dir or .tar.gz instead of GitHub)
set -eu

REPO="rvillaver/BlitzPi"
BUN_VERSION="1.4.0"
MODE="install"; YES=0; WANT_VERSION=""
for a in "$@"; do
  case "$a" in
    --update) MODE="update"; YES=1 ;;
    --uninstall) MODE="uninstall" ;;
    --yes|-y) YES=1 ;;
    --print-paths) MODE="print-paths" ;;
    --version=*) WANT_VERSION="${a#--version=}" ;;
    --version) WANT_VERSION="__next__" ;;
    *) if [ "$WANT_VERSION" = "__next__" ]; then WANT_VERSION="$a"; else echo "unknown option: $a" >&2; exit 2; fi ;;
  esac
done
[ "$WANT_VERSION" = "__next__" ] && { echo "--version needs a value" >&2; exit 2; }

say()  { printf '%s\n' "$*"; }
die()  { printf 'BlitzPi: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---- operating system → directories + Bun build --------------------------------------------
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Darwin) PLATFORM="darwin"; DEFAULT_HOME="$HOME/Library/Application Support/BlitzPi" ;;
  Linux)  PLATFORM="linux";  DEFAULT_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/blitzpi" ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT) die "Windows is not supported by this installer yet (a PowerShell installer is planned)." ;;
  *) die "unsupported operating system: $OS" ;;
esac
APP="${BLITZPI_HOME:-$DEFAULT_HOME}"
BIN_DIR="$HOME/.local/bin"
SHIM="$BIN_DIR/blitzpi"
BUN="$APP/bun/bin/bun"

case "$ARCH" in
  arm64|aarch64) BUN_ARCH="aarch64" ;;
  x86_64|amd64)  BUN_ARCH="x64" ;;
  *) die "unsupported CPU architecture: $ARCH" ;;
esac
BUN_TARGET="$PLATFORM-$BUN_ARCH"
if [ "$PLATFORM" = "darwin" ] && [ "$BUN_ARCH" = "x64" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  BUN_TARGET="darwin-aarch64"   # Apple Silicon running the installer under Rosetta: use the native build
fi
if [ "$PLATFORM" = "linux" ]; then
  if ldd --version 2>&1 | grep -qi musl; then BUN_TARGET="$BUN_TARGET-musl"; fi
  if [ "$BUN_ARCH" = "x64" ] && ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then BUN_TARGET="$BUN_TARGET-baseline"; fi
fi

if [ "$MODE" = "print-paths" ]; then
  say "platform=$PLATFORM"; say "home=$APP"; say "versions=$APP/versions"; say "current=$APP/current"
  say "bun=$BUN"; say "binDir=$BIN_DIR"; say "shim=$SHIM"; say "bunTarget=$BUN_TARGET"; exit 0
fi

confirm() {  # confirm "question" — yes on --yes/--update; otherwise asks on the terminal (stdin may be the pipe)
  [ "$YES" = 1 ] && return 0
  if [ -r /dev/tty ]; then printf '%s [Y/n] ' "$1"; read -r ans </dev/tty; else printf '%s [Y/n] ' "$1"; read -r ans; fi
  case "${ans:-Y}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---- PATH line in the shell's startup file -------------------------------------------------
MARK="# BlitzPi (added by install.sh)"
rc_file() {
  case "$(basename "${SHELL:-/bin/sh}")" in
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    bash) if [ "$PLATFORM" = "darwin" ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.bashrc"; fi ;;
    *)    echo "$HOME/.profile" ;;
  esac
}
add_path_line() {
  case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; esac
  rc="$(rc_file)"; mkdir -p "$(dirname "$rc")"; touch "$rc"
  grep -qF "$MARK" "$rc" && return 0
  if [ "$(basename "$rc")" = "config.fish" ]; then line="fish_add_path \"$BIN_DIR\""; else line="export PATH=\"$BIN_DIR:\$PATH\""; fi
  printf '\n%s\n%s\n' "$MARK" "$line" >>"$rc"
  RC_TOUCHED="$rc"
}
remove_path_line() {
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.config/fish/config.fish"; do
    [ -f "$rc" ] && grep -qF "$MARK" "$rc" || continue
    tmp="$rc.blitzpi.tmp"; grep -vF "$MARK" "$rc" | grep -vF "$BIN_DIR" >"$tmp" || true; mv "$tmp" "$rc"
  done
}

# ---- uninstall -----------------------------------------------------------------------------
if [ "$MODE" = "uninstall" ]; then
  say "This removes BlitzPi:"; say "  app directory : $APP"; say "  command       : $SHIM"
  say "Your logins (~/.pi) and audit trail (~/.blitz) are kept."
  confirm "Uninstall BlitzPi?" || { say "Cancelled."; exit 0; }
  rm -rf "$APP"; rm -f "$SHIM"; remove_path_line
  say "BlitzPi has been uninstalled."; exit 0
fi

# ---- resolve the version to install ---------------------------------------------------------
have curl || die "curl is required"; have tar || die "tar is required"; have unzip || die "unzip is required (macOS has it; on Linux: apt/dnf/pacman install unzip)"
fetch() { curl -fsSL --retry 3 --retry-delay 1 "$@"; }

SOURCE="${BLITZPI_SOURCE:-}"
if [ -n "$SOURCE" ]; then
  VERSION="${WANT_VERSION:-local}"
  [ -d "$SOURCE" ] && VERSION="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$SOURCE/package.json" | head -1)"
  [ -n "$VERSION" ] || VERSION="local"
elif [ -n "$WANT_VERSION" ]; then
  VERSION="${WANT_VERSION#v}"
else
  VERSION="$(fetch "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)" \
    || die "could not reach GitHub to find the latest release"
  [ -n "$VERSION" ] || die "no release found for $REPO (publish one with: gh release create vX.Y.Z)"
fi
DEST="$APP/versions/$VERSION"
CURRENT_VERSION=""
[ -L "$APP/current" ] && CURRENT_VERSION="$(basename "$(readlink "$APP/current")")"

if [ "$MODE" = "update" ] && [ "$CURRENT_VERSION" = "$VERSION" ] && [ -z "$SOURCE" ]; then
  say "BlitzPi $VERSION is already the latest version."; exit 0
fi

# ---- plan + consent -------------------------------------------------------------------------
say ""
if [ "$MODE" = "update" ]; then say "Updating BlitzPi ${CURRENT_VERSION:-?} -> $VERSION"; else say "BlitzPi $VERSION — $OS $ARCH"; fi
say "  app directory : $APP"
say "  runtime       : $APP/bun  (private Bun $BUN_VERSION, $BUN_TARGET)"
say "  version       : $DEST"
say "  command       : $SHIM"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) say "  shell startup : $(rc_file)  (one line so 'blitzpi' is found)";; esac
say "Nothing is installed anywhere else on your system."
say ""
confirm "Install here?" || { say "Cancelled. Set BLITZPI_HOME to choose another directory."; exit 0; }

mkdir -p "$APP/versions" "$APP/tmp" "$BIN_DIR"
TMP="$(mktemp -d "$APP/tmp/XXXXXX")"; trap 'rm -rf "$TMP"' EXIT

# ---- private Bun runtime ---------------------------------------------------------------------
if [ ! -x "$BUN" ] || [ "$(cat "$APP/bun/VERSION" 2>/dev/null)" != "$BUN_VERSION" ]; then
  say "Downloading Bun $BUN_VERSION ($BUN_TARGET)..."
  fetch -o "$TMP/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-$BUN_TARGET.zip"
  unzip -oq "$TMP/bun.zip" -d "$TMP/bun"
  rm -rf "$APP/bun.new"; mkdir -p "$APP/bun.new/bin"
  mv "$TMP/bun/bun-$BUN_TARGET/bun" "$APP/bun.new/bin/bun"; chmod +x "$APP/bun.new/bin/bun"
  printf '%s' "$BUN_VERSION" >"$APP/bun.new/VERSION"
  rm -rf "$APP/bun"; mv "$APP/bun.new" "$APP/bun"
fi
"$BUN" --version >/dev/null 2>&1 || die "the downloaded Bun runtime does not run on this machine ($BUN_TARGET)"

# ---- BlitzPi release → versions/<version> ----------------------------------------------------
STAGE="$DEST.partial"; rm -rf "$STAGE"; mkdir -p "$STAGE"
if [ -n "$SOURCE" ] && [ -d "$SOURCE" ]; then
  say "Copying BlitzPi from $SOURCE..."
  (cd "$SOURCE" && tar --exclude=./node_modules --exclude=./.git --exclude=./runs -cf - .) | tar -C "$STAGE" -xf -
else
  if [ -n "$SOURCE" ]; then TARBALL="$SOURCE"; else
    say "Downloading BlitzPi $VERSION..."
    TARBALL="$TMP/blitzpi.tar.gz"; fetch -o "$TARBALL" "https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz"
  fi
  tar -C "$STAGE" --strip-components=1 -xzf "$TARBALL"
fi
say "Installing Pi and bundled packages (this takes a minute)..."
(cd "$STAGE" && "$BUN" install --frozen-lockfile --production >"$STAGE/.install.log" 2>&1) \
  || { tail -20 "$STAGE/.install.log" >&2; die "dependency install failed (log: $STAGE/.install.log)"; }
PI_NAME="$("$BUN" -e 'process.stdout.write(require("./node_modules/@earendil-works/pi-coding-agent/package.json").piConfig?.name||"")' 2>/dev/null || true)"
# Bun applies patches/ when installing from a lockfile; verify rather than assume.
[ "$PI_NAME" = "blitzpi" ] || die "rebrand patch was not applied (piConfig.name='$PI_NAME')"
rm -rf "$DEST"; mv "$STAGE" "$DEST"

# ---- switch `current` atomically, write the command, keep one previous version ---------------
ln -sfn "versions/$VERSION" "$APP/current"   # -n: replace the link itself, never write inside the old target (GNU + BSD ln)
cat >"$SHIM" <<SHIM
#!/bin/sh
# BlitzPi — written by install.sh. App directory: $APP
APP="\${BLITZPI_HOME:-$APP}"
exec "\$APP/bun/bin/bun" "\$APP/current/bin/blitzpi.ts" "\$@"
SHIM
chmod +x "$SHIM"
for v in "$APP"/versions/*; do
  n="$(basename "$v")"
  [ "$n" = "$VERSION" ] || [ "$n" = "$CURRENT_VERSION" ] || rm -rf "$v"
done
RC_TOUCHED=""; add_path_line

# ---- self-check ------------------------------------------------------------------------------
OUT="$("$SHIM" --version </dev/null 2>&1)" || die "installed but 'blitzpi --version' failed: $OUT"
say ""
say "Installed: $OUT"
if [ -n "$RC_TOUCHED" ]; then say "Open a NEW terminal window, then run:  blitzpi"; else say "Run:  blitzpi"; fi
[ "$MODE" = "install" ] && say "First time: type /login inside BlitzPi to sign in to a provider."
exit 0
