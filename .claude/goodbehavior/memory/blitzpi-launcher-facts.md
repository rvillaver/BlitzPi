---
name: blitzpi-launcher-facts
description: How the blitzpi launcher works after Phase 0 (2026-08-29) and the traps hit building it — bun link, require.resolve for Pi's cli.js, sendMessage invisible in -p mode, audit.getPath() is a directory
metadata:
  type: project
---

- `blitzpi` = `bin/blitzpi.ts` → `src/launcher.ts` → `spawn(bun, [<pi>/dist/bundle/cli.js, "-e", <repo>/src/index.ts, ...args])`. Pi's cli is found with `createRequire(<repo>/package.json).resolve("@earendil-works/pi-coding-agent/package.json")`. `bun link` in the repo puts `blitzpi`/`blitz` in `~/.bun/bin`.
- Extension loads from **source**; there is no build. `dist/` was removed and untracked (`git rm -r --cached dist`).
- `pi.sendMessage({display:true})` renders only in the TUI; in `-p` mode print to stdout (`ctx.hasUI` false) or the command shows nothing.
- `AuditLogger.getPath()` returns the audit **directory** (`.blitz/audit`), not a file.
- Extension commands work in print mode: `blitzpi -p "/blitz-security"` — handy for headless verification.
- Probes show which credential Pi used: the `governance_check` audit line carries the model (`gpt-5.5` ⇒ openai-codex OAuth).

**How to apply:** verify Phase items with `blitzpi -p … </dev/null`; for TUI-only behavior (header, message rendering) the user runs `blitzpi` at the gate. See [[pi-hook-and-bundle-traps]], [[credentials-via-pi-login]].

**Addendum (user TUI run, 2026-08-29):** runtime `console.log/error` from extension hooks draws raw text over Pi's TUI (`[Blitz:Gov…` fragment at the top of the screen). Runtime decisions must go to the audit log + `ctx.ui.notify`/`setStatus`, never console; startup-time logs before the TUI mounts are fine. A thrown error in a hook renders as a full stack trace in the chat.

**Addendum 2 (Command Code):**
- Bundled pi packages load by path: `-e <repo>/node_modules/<pkg>` (dir with `pi` manifest) — `BUNDLED_PI_PACKAGES` in `src/launcher.ts`. Provider id is `commandcode` (62 models from `~/.pi/agent/commandcode-models.json`).
- **Pi subcommands must precede `-e`.** `pi -e x auth check …` / `pi -ne auth check …` run as a *prompt* (an LLM call — and the model will happily "answer" the auth check by reading files; that output is not evidence).
- `pi auth check --provider X` says `not_ready` for both "no credential" and "unknown provider". To prove a provider registered without logging in, use a probe command over `ctx.modelRegistry.getAll()`. `--list-models` shows only credentialed providers.

**Addendum 3 (Phase 1):**
- The repo is loaded as a pi package: `-e <REPO_ROOT>` with `package.json` `"pi": {extensions, themes, skills}`. Skills need YAML frontmatter (`name:`/`description:`) — plain `# name` markdown is silently ignored (the old stub skills never loaded).
- Prove what loaded with a probe command: `pi.getAllTools()`, `pi.getCommands()`, `ctx.modelRegistry.getAll()` via `blitzpi -e probe.ts -p "/probe"` — no LLM call, works from any cwd.
- Rebrand = `bun patch @earendil-works/pi-coding-agent` → edit `piConfig.name` → `bun patch --commit …`; env prefix becomes `BLITZPI_CODING_AGENT_DIR`; `configDir` unchanged so logins persist.
- `.pi/agents/*.md` `model:` must name a model the user's plan has, else the Agent tool reports "model is not available".

**Addendum 4 (Phase 4):** inside the bwrap bash sandbox `/tmp` is a private tmpfs — a write to `/tmp/x` "succeeds" but never touches the host, and a host secret placed in `/tmp` is invisible. To demonstrate/verify the real bind policy, put the out-of-workspace secret under `$HOME` (not mounted) and target writes at a `--ro-bind` dir like `/usr` ("Read-only file system"). `blitz demo` regenerates `docs/verification/DEMO.md` from live runs. Real e2e tests are opt-in behind `BLITZ_E2E=1`.

**Addendum 5 (CRITICAL testing lesson, 2026-08-29):** `blitzpi -p` (print mode) does NOT start the TUI — it does not load/validate themes and does not render the header. Verifying theme or header work with `-p` is invalid and led to two false "verified" claims (an invalid theme that dumped 45 missing-token errors on every TUI launch; an unconfirmed header). TUI-only features MUST be verified by driving a real interactive session (pseudo-terminal via `script -q -c "... | blitzpi"`), then grepping the captured buffer for the actual error/text. Pi themes require ALL 55 color tokens from `dist/modes/interactive/theme/dark.json`; build custom themes by copying Pi's and overriding only accent tokens.

**Addendum 6 (correct TUI verification, 2026-08-29):** to verify anything TUI-only (themes, header, banner) use a REAL pty — `tests/tools/pty-smoke.py` (pty.fork → exec blitzpi → read → ctrl+o → /exit → capture). `blitzpi -p` and `script -c "…|blitzpi"` both make Pi non-interactive (piped stdin) and never render themes/header — they gave false "0 errors". Findings: Pi themes need all 55 tokens (build from dist/modes/interactive/theme/dark.json). `ctx.ui.setTitle` works; `ctx.ui.setHeader` does NOT replace Pi's hardcoded startup π-mascot ("pi v0.84.3") in 0.84.3 even with the exact upstream example shape — a console.log banner does render. APP_TITLE=blitzpi confirms the bun-patch rebrand is effective.

**Addendum 7 (macOS, 2026-08-29):** macOS ships `sandbox-exec` (`/usr/bin/sandbox-exec`, Seatbelt) built-in — the no-install counterpart to bwrap, the natural hardened `SandboxBackend` for Mac (Apple-deprecated but present). On macOS `/etc`→`/private/etc`, `/var`→`/private/var` via realpath, so BLOCKED_PATHS must include the `/private/*` forms or `/etc/passwd` gets the generic "outside workspace" reason instead of "special path" (still blocked, just labeled differently). Tests that assert exact block-reason strings are brittle cross-platform — assert `blocked===true` + `/special path|outside sandbox/`.

**Addendum 8 (macOS sandbox regression, 2026-08-29):** BLOCKED_PATHS is a prefix blocklist; it MUST be checked AFTER workspace-containment, never before. Adding `/private/var` to it broke every macOS run because temp dirs (and often the workspace itself) live under `/private/var/folders/...` → legit in-workspace writes were denied as "special path /private/var". Correct order in checkPathSandbox: (1) if resolved path is inside resolved run_dir → ALLOW; (2) only then apply the system blocklist to outside paths. Keep the blocklist conservative (/dev /proc /sys /etc /private/etc) — not broad dirs like /private/var, /System, /Library that legit paths sit under.

**Milestone (2026-08-29):** cross-platform bash confinement verified on BOTH OSes — Linux bwrap (smoke 16/0) and macOS sandbox-exec/Seatbelt (smoke 15/0, in-workspace write allowed, out-of-workspace blocked), with the pinned guard as fallback. No installs required on either. Windows AppContainer remains the only unbuilt backend.

**Addendum 9 (fresh-workspace lockout, 2026-08-29):** In a workspace with no `.blitz/profiles/`, the
access-profile matcher used to deny EVERY tool ("Profile not found") — no fallback, no prompt — bricking
read/write/bash. Fixed: `access-profiles.ts` seeds a BUILTIN_DEFAULT_PROFILE (`tool:"*" allowed`) and
`getProfile()` falls back to it, so tools are allowed and the sandbox/guard do the confining. Also
narrowed threat-detection's command-injection heuristic — it was flagging normal shell (`2>/dev/null`,
`$(...)`, backticks, `&&`); now only download|shell, `nc -e`, and `/dev/tcp/` reverse-shell shapes.
Design: profiles = WHICH tools (permissive default), sandbox = file paths, bash guard = allow/confirm/deny.

**Addendum 10 (context anchoring + GoodBehavior adoption, 2026-08-29):** BlitzPi is a GENERAL governed
coding agent; it must anchor to the user's cwd, not to its own install. Fixes: (1) system prompt is
built per-cwd (`buildSystemPrompt(cwd)` in blitz-config.ts) — neutral identity, "your workspace is
<cwd>", install dir off-limits, OS-agnostic; injected via before_agent_start. (2) GoodBehavior skills
are NOT shipped globally (they auto-fired `audit-goodbehavior` and made the agent audit BlitzPi against
the user's app request). Only a bootstrap `adopt-goodbehavior` skill ships (skills-bootstrap/). (3)
`/adopt-goodbehavior` command (src/adopt-goodbehavior.ts) copies the 7 GB skills from the install's
.claude/skills into `<cwd>/.pi/skills/` + creates `.claude/goodbehavior/memory/`; reload (needs project
trust: `-a` or the interactive trust prompt) loads them as PROJECT skills. Pi loads project skills from
`.pi/skills/` and `.agents/skills/` after trust.

**Addendum 11 (zones + permission gate, 2026-08-29):** Rebuilt the file/bash security around ZONES
(src/zones.ts) + a permission LADDER (src/permissions.ts) resolved by a runtime GATE
(src/permission-gate.ts). Zones: project / project-config / goodbehavior / install / global / system /
plumbing / other. Ladder: read project/gb/plumbing = silent, else ask; write project/gb = ask,
project-config = ask-no-Always, plumbing = silent, else dangerous. Prompt = ui.select([Yes, No, Always
this session, Always]); dangerous = red + Yes/No; non-interactive auto-allows silent/ask and refuses
dangerous. Key separations: (1) access profiles now govern TOOLS ONLY — allowed_paths ignored (paths are
the gate's job) or they double-block. (2) audit is GLOBAL (~/.blitz/audit) always. (3) no system-prompt
injection — the coding flow is plain Pi; security enforced by hooks. (4) adopt writes .blitz/goodbehavior
not .claude. (5) bash: approved in-project runs under the OS backend; approved out-of-project runs
unconfined; blocked doesn't run. Verified: interactive Yes/No/Always prompt renders in a real pty;
in-project write works; /dev/null never prompts; out-of-project write refused in -p; audit global; no
.claude in the project.
