# Changelog

Governance changes are called out explicitly in every release: what the runtime enforces, what it merely observes, and what changed for the agent.

## 1.2.2 — 2026-08-30

### Install
- **`rollback` / `versions` / `use` / `update` / `uninstall` work whichever version is current.** Found live: after `blitzpi rollback` to 1.2.0, a second `blitzpi rollback` reached 1.2.0's own command, which does not know the word — it went to Pi as a prompt and the model answered it. The command now routes self-service subcommands to an app-level copy of the newest installer (`<app>/install.sh`, refreshed on every install/update, kept outside `versions/`), so an older version being current cannot take them away. Covered by the install smoke test with a fake old version.

## 1.2.1 — 2026-08-30

### Install
- **Rollback is a command.** `blitzpi rollback` switches `current` back to the version you updated from — instant and offline (it just repoints the symlink and re-runs the self-check); run it again to return. `blitzpi versions` lists what is installed with the current and previous marked; `blitzpi use <version>` switches to any installed one. Before, the "previous version kept for rollback" could only be used by hand (`ln -sfn`).
- `blitzpi update --version vX.Y.Z` switches to that version if it is already installed instead of downloading it again (`--reinstall` forces a download).
- `BLITZPI_KEEP` (default 2) sets how many installed versions stay; the new one and the one you left are never removed.
- Versioning from here on: every push is a patch release (1.2.x); the minor moves for a real feature jump.

## 1.2.0 — 2026-08-30

### Governance
- **A URL in a command no longer escapes the sandbox.** The bash guard read `https://example.com` as the path `//example.com` (zone *other*), so any command naming a URL was classified out-of-project and — once approved, automatically in print mode — ran **unconfined**, outside bwrap/Seatbelt. URLs are stripped before path extraction; `curl … https://…` now runs confined like every other in-project command (verified live: `bash_exec … confined: true, backend: bwrap`).
- `bash_exec` audit entries record the **whole command** (was cut at 200 chars) plus best-effort facts from the command line: `deletes` (rm/rmdir/unlink/shred, `git rm`, `find … -delete` targets) and `urls`. Pi has no delete or fetch tool, so bash is the only place either can be seen.
- `permission_check` entries carry `tool` (`bash command` vs the file tool), so blocked bash and blocked file ops can be told apart after the fact.
- **Compaction is audited.** Pi already extracts the files read / modified from the messages it is about to summarise away; that list is now written as a `compaction` audit entry (`reason`, `tokens_before`, `read_files`, `modified_files`) so a project report still knows what was touched after the context is gone. Failed compactions are recorded too. Pi's summary itself is untouched.

### Diagnostics
- **The counters are inspectable.** `/blitz-security files | bash | governance | all` lists this session's decisions behind the numbers (which files, which commands with their deletes/URLs, which denials), with a files summary (read / written / blocked). The panel names this session's audit file. The status bar says `· N blocked → /blitz-security` once anything was blocked.
- **`/blitz-report` and `blitzpi report [PATH] [--since ISO] [--format json]`**: one project across sessions — files read / written / blocked / deleted, URLs, commands (confined vs not), governance checks and denials, threats, compactions, plus Pi's usage (sessions, messages, tool calls, tokens, cached share, cost estimate, models). Folds `~/.blitz/audit` and `~/.pi/agent/sessions`; nothing new is collected.
- **Projects registry** `~/.blitz/projects.json`: a project is registered when BlitzPi sets it up and touched on every session start (sessions, last seen, version, GoodBehavior profile). `blitzpi projects` lists them with their state (ok / +goodbehavior / no .blitz / missing); `prune` drops the missing ones; `forget PATH` drops one.
- **Audit housekeeping**: `blitzpi audit --project PATH` filters to one project; `--prune [--dry-run]` removes empty session files (headless probes) and files whose project directory is gone. The table's Details column now says what happened (`read src/x.ts`, `confined: bun test`, `threshold: 3 read, 2 modified`), not just the type.
- `/session` (Pi's built-in usage / cost view) is advertised in the banner and panel.

## 1.1.4 — 2026-08-30

### Governance
- **Per-call governance now enforces.** `governance.mode: enforce` (the default) stops a denied model call: the run's abort signal fires before the request is sent, the call never happens, the turn ends with a chat notice, and the audit entry carries `stage: provider_request, enforced: true`. `governance.mode: monitor` keeps the old behaviour (recorded and shown, call goes out). Provider outages (`api_error`) are never enforced — an unreachable governance service must not silently stop work; they are shown and counted instead.
- The input gate (before a turn) is unchanged and still enforces prompt-injection / model-whitelist decisions.
- Denial notices are displayed without being sent to the model (a notice the model can see re-triggers a turn and loops).

## 1.1.3 — 2026-08-30

### Governance
- **One vocabulary, one source**: every layer reports a mode — `enforce` (the runtime blocks), `monitor` (recorded and shown, not blocked), `off` — from `src/security-status.ts`. The banner prints one row (`governance local (monitor) · profile user (enforce) · files (enforce) · bash bwrap (enforce) · threat tier 2 (enforce) · audit (enforce)`); the status bar is steady (`🛡 local · monitor`) and only changes on a denial or an unreachable provider; a denial is also posted to the chat, saying what would have happened under `enforce`. "audit-only" is gone.
- **`/blitz-security` is a real command** (before, it and `/blitz-profile` / `/blitz-audit` were advertised but not registered — typing them sent the text to the model, which invented a panel). It shows every layer's mode, where it is configured, this session's counters (calls checked / denied, tools / files / bash / threats / prompts blocked) and the last decisions. The two phantom commands are no longer advertised; the audit trail's interface is `blitzpi audit`.
- **Prompt hygiene**: Pi's "Pi documentation" block, which pointed the agent at BlitzPi's own install directory, is stripped from the system prompt.
- **Credential rejections are explained**: an HTTP 401/403 from the model provider shows "run /login again or pick another provider" instead of raw JSON, and is audited as `provider_auth_error`.
- **No npm needed**: setting up a workspace pins Pi's package operations to the runtime running BlitzPi (`npmCommand` in the project's `.pi/settings.json`), so `npm root -g` is never run on machines without npm. User settings are never touched.

## 1.1.2 — 2026-08-30

### Governance
- **Sandboxed commands were randomly killed ~130 ms in** (Linux/bwrap). `--die-with-parent` uses `PR_SET_PDEATHSIG`, which is bound to the *thread* that spawned the sandbox; Bun (running Pi) spawns from pool threads that get reaped, so `bun add`/`bun install` died mid-download in about half the runs and the agent concluded "installs hang". The flag is gone; BlitzPi now tracks sandbox children itself and kills them on abort, on Pi exit and on SIGINT/SIGTERM/SIGHUP (with `--unshare-pid`, killing bwrap kills everything inside). Isolation is unchanged.
- `bash_exit` audit entries record exit code, abort state and elapsed time for every sandboxed command.

## 1.1.1 — 2026-08-29

### Governance
- **Threat detection scans instructions, not output.** Patterns run only over a tool call's `command`, `path`/`file` and `url` fields. File content and edit text are never regex-scanned. Before: every `write`/`edit` whose content contained a `?` was blocked as "path traversal" (the pattern list literally included `/\?/`), and content with an email or a 9-digit number was blocked as "PII". The agent was reduced to `String.fromCharCode(47)` tricks.
- **PII in a command is observed, not blocked** (audit `action: pii_observed`). The agent's own tool input is not exfiltration.
- **Path traversal**: only URL-encoded traversal (`%2e%2e`, `..%2f`) or 3+ `../` segments in a *path field* count. `../shared/x.ts` is normal.
- **New zone `scratch`** — the OS temp dir (`/tmp`, `$TMPDIR`, macOS `/private/tmp`): read/write silent, treated as in-scope. bwrap binds the host temp dir (was a private tmpfs the file tools couldn't see); Seatbelt allows writes there; `TMPDIR` is no longer pinned to the workspace. Don't keep secrets in `/tmp`.
- **The private Bun is reachable in the sandbox**: the shim exports `<app>/bun/bin` on `PATH`, and bwrap binds the runtime directory read-only. `bun init` / `bun install` / `bun run` work inside a governed shell.
- Pi's own version check is off (`PI_SKIP_VERSION_CHECK`): BlitzPi owns updates via `blitzpi update`; the old banner told users to run a command that would say "already latest".

## 1.1.0 — 2026-08-29

### Governance
- **Permission memory grain**: an "Always" on reading outside the project now covers only the approved directory root (nearest enclosing project or the path's own dir). `/`, home, its ancestors and top-level dirs are never remembered. Legacy disk-wide `read:other` entries in `.blitz/permissions.json` are ignored. Before: one "Always" unlocked every other project and `/`.
- GoodBehavior doctrine is one data file (the profile) injected into the system prompt only in adopted projects; nothing security-related is put in the prompt (the runtime enforces).
- `/adopt-goodbehavior` / `/unadopt-goodbehavior`; `blitzpi uninstall --purge` also removes `~/.blitz`.

## 1.0.1 — 2026-08-29
- Installer fix (post-install check ran outside the staged copy); Bun caches kept inside the app dir.

## 1.0.0 — 2026-08-29
- First self-contained release: private Bun runtime + Pi 0.84.3 + bundled packages in one app directory; `blitzpi update` / `blitzpi uninstall`.
