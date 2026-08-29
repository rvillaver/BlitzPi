#!/usr/bin/env bash
# BlitzPi install smoke test — portable (macOS + Linux). Run from the repo root:
#   bash scripts/smoke-test.sh
# Verifies: prereqs, install, rebrand patch, launcher runs, a real prompt, themes valid, no cwd litter.
set -u
pass=0; fail=0; warn=0
ok(){   printf "  \033[32mPASS\033[0m %s\n" "$1"; pass=$((pass+1)); }
no(){   printf "  \033[31mFAIL\033[0m %s\n" "$1"; fail=$((fail+1)); }
wn(){   printf "  \033[33mWARN\033[0m %s\n" "$1"; warn=$((warn+1)); }
hdr(){  printf "\n\033[1m== %s ==\033[0m\n" "$1"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || { echo "cannot cd to repo root"; exit 2; }
OS="$(uname -s)"
echo "BlitzPi smoke test — $OS — repo: $ROOT"
echo "commit: $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)   (compare to origin: git pull if behind)"

hdr "Prerequisites"
command -v bun >/dev/null && ok "bun present ($(bun --version))" || no "bun missing (install: curl -fsSL https://bun.sh/install | bash)"
command -v git >/dev/null && ok "git present" || no "git missing"
if command -v bwrap >/dev/null; then ok "bwrap present — bash sandbox active"
else wn "bwrap absent (expected on macOS) — bash runs via the cross-platform scope guard (not OS-isolated); install bwrap on Linux for OS isolation"; fi

hdr "Install"
bun install >/tmp/blitz-install.log 2>&1 && ok "bun install" || { no "bun install (see /tmp/blitz-install.log)"; }

hdr "Rebrand patch applied"
NAME="$(bun -e 'try{process.stdout.write(require("./node_modules/@earendil-works/pi-coding-agent/package.json").piConfig?.name||"")}catch(e){}' 2>/dev/null)"
[ "$NAME" = "blitzpi" ] && ok "piConfig.name = blitzpi" || no "piConfig.name = '$NAME' (expected blitzpi — patch not applied)"

hdr "Launcher runs"
H="$(bun bin/blitzpi.ts --help </dev/null 2>&1)"
printf '%s' "$H" | grep -q "^blitzpi - " && ok "blitzpi --help shows 'blitzpi'" || no "help did not show blitzpi banner"

hdr "Themes valid (all 55 tokens)"
for t in blitzpi-dark blitzpi-light; do
  N="$(bun -e "try{process.stdout.write(String(Object.keys(require('./.pi/themes/$t.json').colors).length))}catch(e){process.stdout.write('0')}" 2>/dev/null)"
  [ "$N" = "55" ] && ok "$t.json has 55 tokens" || no "$t.json has $N tokens (need 55)"
done

hdr "Typecheck & tests"
bunx tsc --noEmit -p tsconfig.json >/tmp/blitz-tsc.log 2>&1 && ok "tsc clean" || no "tsc errors (see /tmp/blitz-tsc.log)"
if bunx jest >/tmp/blitz-jest.log 2>&1; then ok "jest: $(grep -E 'Tests:' /tmp/blitz-jest.log | tail -1 | sed 's/^ *//')"; else no "jest failed (see /tmp/blitz-jest.log)"; fi

hdr "Real prompt (needs a login; skips if none)"
if bun bin/blitzpi.ts auth check --provider openai-codex </dev/null 2>&1 | grep -qi "ready\|valid"; then
  R="$(bun bin/blitzpi.ts -p 'say the single word: pong' </dev/null 2>&1)"
  printf '%s' "$R" | grep -qi "pong" && ok "agent replied to a prompt" || no "no reply (output tail: $(printf '%s' "$R" | tail -1))"
  printf '%s' "$R" | grep -q "Extension error" && no "extension error during prompt" || ok "no extension errors on prompt"
else
  wn "no provider login found — run 'blitzpi' then /login, then re-run this test for the live-prompt check"
fi

hdr "No cwd litter"
D="$(mktemp -d)"; ( cd "$D" && bun "$ROOT/bin/blitzpi.ts" --help </dev/null >/dev/null 2>&1 )
[ -e "$D/.pi" ] && no ".pi created in a foreign cwd: $(ls "$D/.pi")" || ok "no .pi written into other directories"
rm -rf "$D"

hdr "Bash sandbox backend"
BK="$(bun bin/blitzpi.ts -p 'noop' </dev/null 2>&1 | grep -oE 'backend=[a-z-]+' | head -1)"
[ -n "$BK" ] && ok "blitzpi selects $BK" || wn "could not read backend line from startup"

WT="$(cd "$(mktemp -d)" && pwd -P)"  # pwd -P resolves symlinks (macOS /var -> /private/var)
if [ "$OS" = "Darwin" ] && command -v sandbox-exec >/dev/null; then
  PROFILE="(version 1)(allow default)(deny file-write*)(allow file-write* (subpath \"$WT\"))"
  IN_ERR="$(sandbox-exec -p "$PROFILE" /bin/bash -c "echo ok > '$WT/in'" 2>&1 1>/dev/null)"
  if [ -f "$WT/in" ]; then ok "sandbox-exec: in-workspace write allowed"; else no "sandbox-exec: in-workspace write blocked — ${IN_ERR:-no error text} (subpath=$WT)"; fi
  sandbox-exec -p "$PROFILE" /bin/bash -c "echo x > /tmp/__blitz_sbescape_$$" 2>/dev/null
  if [ -f "/tmp/__blitz_sbescape_$$" ]; then no "sandbox-exec: OUT-of-workspace write SUCCEEDED (isolation broken)"; rm -f "/tmp/__blitz_sbescape_$$"; else ok "sandbox-exec: out-of-workspace write blocked"; fi
elif command -v bwrap >/dev/null; then
  R="$(bwrap --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
       --proc /proc --dev /dev --tmpfs /tmp --bind "$WT" "$WT" --chdir "$WT" --unshare-user --die-with-parent \
       /bin/bash -c 'echo ok > in && echo IN_OK; echo x > /usr/__blitz_sbescape 2>/dev/null && echo ESCAPED' 2>/dev/null)"
  printf '%s' "$R" | grep -q IN_OK   && ok "bwrap: in-workspace write allowed" || no "bwrap: in-workspace write blocked"
  printf '%s' "$R" | grep -q ESCAPED && no "bwrap: OUT-of-workspace write SUCCEEDED (isolation broken)" || ok "bwrap: out-of-workspace write blocked"
else
  wn "no OS sandbox (bwrap/sandbox-exec) — bash uses the cross-platform guard only (scope + confirm + audit)"
fi
rm -rf "$WT"

printf "\n\033[1m== Summary ==\033[0m  \033[32m%d pass\033[0m  \033[31m%d fail\033[0m  \033[33m%d warn\033[0m\n" "$pass" "$fail" "$warn"
[ "$fail" -eq 0 ] && { echo "RESULT: OK"; exit 0; } || { echo "RESULT: FAILURES"; exit 1; }
