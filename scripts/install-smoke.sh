#!/usr/bin/env bash
# End-to-end test of install.sh in a throwaway HOME (real Bun download, real `bun install`, real launch).
# The app dir has a space in it on purpose (macOS "Application Support").   bash scripts/install-smoke.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok(){ printf "  \033[32mPASS\033[0m %s\n" "$1"; pass=$((pass+1)); }
no(){ printf "  \033[31mFAIL\033[0m %s\n" "$1"; fail=$((fail+1)); }
FAKEHOME="$(mktemp -d)"; export HOME="$FAKEHOME"; unset XDG_DATA_HOME
export BLITZPI_HOME="$HOME/App Dir/BlitzPi"   # space in the path, like macOS "Application Support"
export SHELL=/bin/zsh   # deterministic rc file: ~/.zshrc
echo "install-smoke — HOME=$HOME — app=$BLITZPI_HOME — source=$ROOT"

cd "$(mktemp -d)"   # foreign cwd: the installer must never rely on the repo's own node_modules
echo "== install (local source, --yes)"
BLITZPI_SOURCE="$ROOT" sh "$ROOT/install.sh" --yes >"$HOME/install.log" 2>&1 && ok "install.sh exit 0" || { no "install.sh failed"; tail -30 "$HOME/install.log"; }
P="$(sh "$ROOT/install.sh" --print-paths)"; APP="$(printf '%s' "$P" | sed -n 's/^home=//p')"; SHIM="$(printf '%s' "$P" | sed -n 's/^shim=//p')"
[ -x "$APP/bun/bin/bun" ] && ok "private bun at $APP/bun/bin/bun ($("$APP/bun/bin/bun" --version))" || no "no private bun"
[ -L "$APP/current" ] && ok "current -> $(readlink "$APP/current")" || no "no current symlink"
[ -d "$APP/current/node_modules/@earendil-works/pi-coding-agent" ] && ok "Pi installed inside the version dir" || no "Pi missing"
[ -d "$APP/current/node_modules/jest" ] && no "devDependencies were installed" || ok "production install (no devDependencies)"
[ -x "$SHIM" ] && ok "command at $SHIM" || no "no command"
grep -q "BlitzPi" "$HOME/.zshrc" 2>/dev/null && ok "PATH line added to ~/.zshrc" || no "no PATH line in ~/.zshrc"
[ -e "$HOME/.bun" ] && no "~/.bun was created (cache leaked outside the app dir)" || ok "nothing outside the app dir (no ~/.bun)"

echo "== run it (no PATH, no bun on PATH, from a foreign cwd)"
D="$(mktemp -d)"; V="$(cd "$D" && env -i HOME="$HOME" PATH=/usr/bin:/bin "$SHIM" --version </dev/null 2>&1)"
printf '%s' "$V" | grep -q "^blitzpi .* (pi 0.84.3, bun " && ok "blitzpi --version: $V" || no "--version: $V"
Hh="$(cd "$D" && env -i HOME="$HOME" PATH=/usr/bin:/bin "$SHIM" --help </dev/null 2>&1)"
printf '%s' "$Hh" | grep -q "^blitzpi - " && ok "blitzpi --help shows the blitzpi banner (Pi + rebrand loaded)" || { no "--help banner"; printf '%s\n' "$Hh" | head -5; }
[ -e "$D/.pi" ] && no ".pi litter in cwd" || ok "no cwd litter"
grep -q 'export PATH="$APP/bun/bin' "$SHIM" && ok "shim puts the private bun on PATH" || no "shim does not export bun on PATH"
[ -e "$HOME/.bun" ] && no "~/.bun created at runtime (transpiler cache leaked)" || ok "runtime writes nothing outside the app dir"

echo "== update to the same local source (installs a second copy, switches current)"
# bump the version in a copy so it looks like a new release
SRC2="$(mktemp -d)"; (cd "$ROOT" && tar --exclude=./node_modules --exclude=./.git --exclude=./runs -cf - .) | tar -C "$SRC2" -xf -
sed -i.bak 's/"version": "\([0-9.]*\)"/"version": "\1-next"/' "$SRC2/package.json" && rm -f "$SRC2/package.json.bak"
BLITZPI_SOURCE="$SRC2" "$SHIM" update >"$HOME/update.log" 2>&1 && ok "blitzpi update exit 0" || { no "update failed"; tail -20 "$HOME/update.log"; }
readlink "$APP/current" | grep -q -- "-next" && ok "current switched to $(readlink "$APP/current")" || no "current not switched: $(readlink "$APP/current")"
[ "$(ls "$APP/versions" | wc -l)" -eq 2 ] && ok "previous version kept for rollback ($(ls "$APP/versions" | tr '\n' ' '))" || no "versions dir: $(ls "$APP/versions")"
"$SHIM" --version </dev/null 2>&1 | grep -q -- "-next" && ok "new version runs" || no "new version does not run"
ORIG="$(ls "$APP/versions" | grep -v -- "-next")"; NEXT="$(ls "$APP/versions" | grep -- "-next")"

echo "== versions / rollback / use (offline, instant)"
L="$("$SHIM" versions </dev/null 2>&1)"
printf '%s' "$L" | grep -q "^  \* $NEXT" && ok "blitzpi versions marks current (* $NEXT)" || { no "versions output"; printf '%s\n' "$L"; }
printf '%s' "$L" | grep -q "$ORIG.*previous" && ok "versions marks the previous ($ORIG)" || no "previous not marked: $L"
"$SHIM" rollback </dev/null >"$HOME/rollback.log" 2>&1 && ok "blitzpi rollback exit 0" || { no "rollback failed"; cat "$HOME/rollback.log"; }
[ "$(readlink "$APP/current")" = "versions/$ORIG" ] && ok "rollback switched current -> $ORIG" || no "current after rollback: $(readlink "$APP/current")"
"$SHIM" --version </dev/null 2>&1 | grep -qv -- "-next" && ok "rolled-back version runs" || no "rolled-back version does not run"
"$SHIM" rollback </dev/null 2>&1 | grep -q "Now current" && [ "$(readlink "$APP/current")" = "versions/$NEXT" ] && ok "rollback again returns to $NEXT" || no "second rollback: $(readlink "$APP/current")"
"$SHIM" use "$ORIG" </dev/null >/dev/null 2>&1 && [ "$(readlink "$APP/current")" = "versions/$ORIG" ] && ok "blitzpi use $ORIG" || no "use failed: $(readlink "$APP/current")"
"$SHIM" use "$ORIG" </dev/null 2>&1 | grep -q "already current" && ok "use of the current version is a no-op" || no "use current not a no-op"
"$SHIM" use 0.0.0 </dev/null >/dev/null 2>&1 && no "use of a missing version succeeded" || ok "use of a missing version fails"
BLITZPI_SOURCE="$SRC2" "$SHIM" update --version "$NEXT" </dev/null >"$HOME/uselocal.log" 2>&1 && grep -q "already installed" "$HOME/uselocal.log" && [ "$(readlink "$APP/current")" = "versions/$NEXT" ] && ok "update --version <installed> switches without downloading" || { no "update --version local"; cat "$HOME/uselocal.log"; }
[ "$(ls "$APP/versions" | wc -l)" -eq 2 ] && ok "still 2 versions installed" || no "versions dir: $(ls "$APP/versions")"

echo "== uninstall"
mkdir -p "$HOME/.blitz/audit"; touch "$HOME/.blitz/audit/x.jsonl"
"$SHIM" uninstall --yes --purge >/dev/null 2>&1 </dev/null && ok "blitzpi uninstall --yes --purge exit 0" || no "uninstall failed"
[ ! -e "$HOME/.blitz" ] && ok "--purge removed ~/.blitz" || no "~/.blitz still there after --purge"
[ ! -e "$APP" ] && ok "app dir removed" || no "app dir still there"
[ ! -e "$SHIM" ] && ok "command removed" || no "command still there"
grep -q "BlitzPi" "$HOME/.zshrc" && no "PATH line still in ~/.zshrc" || ok "PATH line removed"

rm -rf "$FAKEHOME" "$D" "$SRC2"
printf "\n== %d pass, %d fail\n" "$pass" "$fail"; [ "$fail" -eq 0 ]
