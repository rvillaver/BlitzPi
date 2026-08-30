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
# Layout:  <app>/bun/bin/bun   <app>/versions/<version>/   <app>/current -> versions/<version>   <app>/previous
#          <app>/install.sh — the newest installer that ran; the command routes update / versions / rollback /
#          use / uninstall to it, so they work whichever version is current (an older one has no such commands).
# Updates install the next release as a whole into a new versions/<version> and switch `current`
# atomically; the newest BLITZPI_KEEP (default 2) versions stay installed, so `blitzpi rollback` /
# `blitzpi use <version>` switch instantly and offline. Nothing is installed system-wide.
#
# Options:  --update  --uninstall [--purge]  --yes  --version vX.Y.Z [--reinstall]  --print-paths
#           --feeds | --no-feeds  (security feeds are an OPT-IN download, separate from the platform: asked at
#           install and again at update; the platform always updates, feeds only if you say so)
#           --list  --rollback  --use <version>  --refresh (re-place the app-level installer + command)
# Env:      BLITZPI_HOME (app dir override), BLITZPI_SOURCE (local dir or .tar.gz instead of GitHub),
#           BLITZPI_KEEP (installed versions to keep, default 2)
set -eu

REPO="rvillaver/BlitzPi"
BUN_VERSION="1.4.0"
MODE="install"; YES=0; WANT_VERSION=""; PURGE=0; REINSTALL=0; USE_VERSION=""; FEEDS=""
KEEP="${BLITZPI_KEEP:-2}"; case "$KEEP" in ''|*[!0-9]*) KEEP=2 ;; esac; [ "$KEEP" -ge 1 ] || KEEP=1
for a in "$@"; do
  case "$a" in
    --update) MODE="update"; YES=1 ;;
    --uninstall) MODE="uninstall" ;;
    --purge) PURGE=1 ;;
    --yes|-y) YES=1 ;;
    --reinstall) REINSTALL=1 ;;
    --feeds) FEEDS=yes ;;
    --no-feeds) FEEDS=no ;;
    --print-paths) MODE="print-paths" ;;
    --list) MODE="list" ;;
    --refresh) MODE="refresh" ;;
    --rollback) MODE="rollback" ;;
    --use=*) MODE="use"; USE_VERSION="${a#--use=}" ;;
    --use) MODE="use"; USE_VERSION="__next__" ;;
    --version=*) WANT_VERSION="${a#--version=}" ;;
    --version) WANT_VERSION="__next__" ;;
    --*) echo "BlitzPi: ignoring unknown option $a (this installer predates it)" >&2 ;;
    *) if [ "$WANT_VERSION" = "__next__" ]; then WANT_VERSION="$a"; elif [ "$USE_VERSION" = "__next__" ]; then USE_VERSION="$a"; else echo "unknown argument: $a" >&2; exit 2; fi ;;
  esac
done
[ "$WANT_VERSION" = "__next__" ] && { echo "--version needs a value" >&2; exit 2; }
[ "$USE_VERSION" = "__next__" ] && { echo "--use needs a version (see --list)" >&2; exit 2; }

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

# ---- security feeds: opt-in, separate from the platform ----------------------------------------
# Platform updates always go through. Feeds are the user's choice, asked on install and again on every update
# (also when the platform is already current); `--feeds` / `--no-feeds` answer without asking.
FEEDS_OPT="$HOME/.blitz/feeds/opt-in"
ask_feeds() {  # ask_feeds "question" — never auto-yes: --update sets YES=1 for the platform only.
  # Consent needs an actual answer: Enter/yes on a terminal. EOF (no terminal, piped, CI) is "no", never "yes".
  case "$FEEDS" in yes) return 0 ;; no) return 1 ;; esac
  ans=""
  if [ -r /dev/tty ]; then printf '%s [Y/n] ' "$1"; read -r ans </dev/tty || { say ""; return 1; }
  elif [ -t 0 ]; then printf '%s [Y/n] ' "$1"; read -r ans || { say ""; return 1; }
  else return 1; fi
  case "${ans:-Y}" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}
feeds_step() {
  if [ -f "$FEEDS_OPT" ]; then
    if ask_feeds "Security feeds are installed (blitzpi feeds list). Update them too?"; then "$SHIM" feeds update </dev/null || say "WARNING: feed update failed (previous feeds kept). Retry: blitzpi feeds update"; else say "Security feeds left as they are (blitzpi feeds update when you want them)."; fi
  elif [ "$MODE" = "install" ] || [ "$FEEDS" = yes ]; then
    say ""; say "Security feeds (optional): detection rules pulled from public sources — credentials in commands (gitleaks),"
    say "command shapes (Sigma) and malicious URLs (URLhaus). First download ≈ 4.5 MB (Sigma bundle 3.2 MB, URLhaus 1.3 MB),"
    say "≈ 1.5 MB kept in ~/.blitz/feeds; updated only when you say so (blitzpi feeds update)."
    if ask_feeds "Install security feeds now?"; then "$SHIM" feeds opt-in </dev/null || say "WARNING: feed install failed. Retry: blitzpi feeds opt-in"; else say "Skipped. Later: blitzpi feeds opt-in"; fi
  fi
}

# ---- installed versions: list / switch / rollback (offline, instant) ---------------------------
current_version() { [ -L "$APP/current" ] && basename "$(readlink "$APP/current")" || true; }
installed() { [ -d "$APP/versions/$1/node_modules/@earendil-works/pi-coding-agent" ] && [ -f "$APP/versions/$1/bin/blitzpi.ts" ]; }
list_versions() {  # newest first (by install time)
  [ -d "$APP/versions" ] || return 0
  ls -1t "$APP/versions" 2>/dev/null | while read -r n; do [ -d "$APP/versions/$n" ] && [ "${n%.partial}" = "$n" ] && printf '%s\n' "$n"; done
}
write_shim() {
  mkdir -p "$BIN_DIR"
  cat >"$SHIM" <<SHIM
#!/bin/sh
# BlitzPi — written by install.sh. App directory: $APP
APP="\${BLITZPI_HOME:-$APP}"
# Self-service commands go to the newest installer, not to the version that happens to be current.
if [ -f "\$APP/install.sh" ]; then
  case "\${1:-}" in
    update)    shift; exec sh "\$APP/install.sh" --update "\$@" ;;
    uninstall) shift; exec sh "\$APP/install.sh" --uninstall "\$@" ;;
    versions)  shift; exec sh "\$APP/install.sh" --list "\$@" ;;
    rollback)  shift; exec sh "\$APP/install.sh" --rollback "\$@" ;;
    use)       shift; exec sh "\$APP/install.sh" --use "\$@" ;;
  esac
fi
export BUN_RUNTIME_TRANSPILER_CACHE_PATH="\$APP/cache/transpiler"   # Bun's runtime cache stays inside the app dir, not ~/.bun
export PATH="\$APP/bun/bin:\$PATH"   # the private Bun is available to the agent's shell (bun init / bun install / bun run)
exec "\$APP/bun/bin/bun" "\$APP/current/bin/blitzpi.ts" "\$@"
SHIM
  chmod +x "$SHIM"
}
switch_to() {  # switch_to <version>: point `current` at an installed version, remember the one we left
  installed "$1" || die "version $1 is not installed (installed: $(list_versions | tr '\n' ' '))"
  prev="$(current_version)"
  [ "$prev" = "$1" ] && { say "BlitzPi $1 is already current."; return 0; }
  ln -sfn "versions/$1" "$APP/current"   # -n: replace the link itself, never write inside the old target (GNU + BSD ln)
  [ -n "$prev" ] && printf '%s\n' "$prev" >"$APP/previous"
  write_shim   # idempotent; keeps the command in step with this installer
  OUT="$("$SHIM" --version </dev/null 2>&1)" || die "switched to $1 but 'blitzpi --version' failed: $OUT"
  say "Now current: $OUT${prev:+  (was $prev — 'blitzpi rollback' returns to it)}"
}
refresh_self() {  # this script (when run from a version dir) becomes the app-level installer; the command is rewritten
  case "$0" in */versions/*/install.sh|*/install.sh) [ -f "$0" ] && cp "$0" "$APP/install.sh.new" && mv "$APP/install.sh.new" "$APP/install.sh" ;; esac
  write_shim
}
if [ "$MODE" = "refresh" ]; then mkdir -p "$APP"; refresh_self; say "BlitzPi command refreshed: $SHIM (installer: $APP/install.sh)"; exit 0; fi
if [ "$MODE" = "list" ]; then
  cur="$(current_version)"; prev="$(cat "$APP/previous" 2>/dev/null || true)"
  [ -n "$(list_versions)" ] || die "nothing installed under $APP/versions"
  say "Installed BlitzPi versions ($APP/versions, newest first; keeping $KEEP):"
  list_versions | while read -r n; do
    mark="  "; [ "$n" = "$cur" ] && mark="* "
    note=""; [ "$n" = "$prev" ] && note="   (previous — blitzpi rollback)"
    installed "$n" || note="   (incomplete)"
    say "  $mark$n$note"
  done
  say "  * = current.   Switch: blitzpi use <version>   Roll back: blitzpi rollback   Newer: blitzpi update"
  exit 0
fi
if [ "$MODE" = "use" ]; then switch_to "${USE_VERSION#v}"; exit 0; fi
if [ "$MODE" = "rollback" ]; then
  cur="$(current_version)"; target="$(cat "$APP/previous" 2>/dev/null || true)"
  if [ -z "$target" ] || [ "$target" = "$cur" ] || ! installed "$target"; then
    target="$(list_versions | grep -vx "$cur" | head -1 || true)"   # no record: newest other installed version
  fi
  [ -n "$target" ] || die "no other version installed to roll back to (blitzpi versions)"
  switch_to "$target"; exit 0
fi

# ---- uninstall -----------------------------------------------------------------------------
if [ "$MODE" = "uninstall" ]; then
  say "This removes BlitzPi:"; say "  app directory : $APP"; say "  command       : $SHIM"
  if [ "$PURGE" = 1 ]; then say "  audit + global config : $HOME/.blitz  (--purge)"; fi
  say "Kept: your Pi logins in $HOME/.pi (remove yourself with: rm -rf \"$HOME/.pi\")$( [ "$PURGE" = 1 ] || printf ', your audit trail in %s/.blitz (add --purge to remove)' "$HOME")."
  confirm "Uninstall BlitzPi?" || { say "Cancelled."; exit 0; }
  rm -rf "$APP"; rm -f "$SHIM"; remove_path_line
  [ "$PURGE" = 1 ] && rm -rf "$HOME/.blitz"
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
CURRENT_VERSION="$(current_version)"
if [ -n "$WANT_VERSION" ] && [ "$REINSTALL" = 0 ] && installed "$VERSION"; then
  say "BlitzPi $VERSION is already installed — switching to it (add --reinstall to download it again)."
  switch_to "$VERSION"; exit 0
fi

if [ "$MODE" = "update" ] && [ "$CURRENT_VERSION" = "$VERSION" ] && [ -z "$SOURCE" ]; then
  say "BlitzPi $VERSION is already the latest version."
  feeds_step   # the platform is current; feeds may still be behind
  exit 0
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
# Bun's download cache goes inside the app dir (not ~/.bun): nothing is written outside it.
(cd "$STAGE" && BUN_INSTALL_CACHE_DIR="$APP/cache" "$BUN" install --frozen-lockfile --production >"$STAGE/.install.log" 2>&1) \
  || { tail -20 "$STAGE/.install.log" >&2; die "dependency install failed (log: $STAGE/.install.log)"; }
PI_NAME="$(cd "$STAGE" && "$BUN" -e 'process.stdout.write(require("./node_modules/@earendil-works/pi-coding-agent/package.json").piConfig?.name||"")' 2>/dev/null || true)"
# Bun applies patches/ when installing from a lockfile; verify rather than assume.
[ "$PI_NAME" = "blitzpi" ] || die "rebrand patch was not applied (piConfig.name='$PI_NAME')"
rm -rf "$DEST"; mv "$STAGE" "$DEST"
[ -f "$DEST/install.sh" ] && cp "$DEST/install.sh" "$APP/install.sh.new" && mv "$APP/install.sh.new" "$APP/install.sh"   # app-level installer = newest

# ---- switch `current` atomically, write the command, keep the newest $KEEP versions -----------
ln -sfn "versions/$VERSION" "$APP/current"   # -n: replace the link itself, never write inside the old target (GNU + BSD ln)
[ -n "$CURRENT_VERSION" ] && [ "$CURRENT_VERSION" != "$VERSION" ] && printf '%s\n' "$CURRENT_VERSION" >"$APP/previous"
write_shim
i=0
list_versions | while read -r n; do
  i=$((i+1))
  [ "$n" = "$VERSION" ] || [ "$n" = "$CURRENT_VERSION" ] && continue   # the new one and the one we left always stay
  [ "$i" -le "$KEEP" ] || rm -rf "$APP/versions/$n"
done
RC_TOUCHED=""; add_path_line

# ---- self-check ------------------------------------------------------------------------------
OUT="$("$SHIM" --version </dev/null 2>&1)" || die "installed but 'blitzpi --version' failed: $OUT"
say ""
say "Installed: $OUT"
for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -f "$rc" ] && grep -qE '^[[:space:]]*alias[[:space:]]+blitzpi=' "$rc" || continue
  say "WARNING: $rc defines an 'alias blitzpi=...' from an older setup; it will shadow this install."
  say "         Delete that line, then run:  unalias blitzpi; hash -r"
done
feeds_step
say ""
if [ -n "$RC_TOUCHED" ]; then say "Open a NEW terminal window, then run:  blitzpi"; else say "Run:  blitzpi"; fi
[ "$MODE" = "install" ] && say "First time: type /login inside BlitzPi to sign in to a provider."
exit 0
