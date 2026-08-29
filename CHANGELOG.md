# Changelog

Governance changes are called out explicitly in every release: what the runtime enforces, what it merely observes, and what changed for the agent.

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
