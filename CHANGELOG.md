# Changelog

Governance changes are called out explicitly in every release: what the runtime enforces, what it merely observes, and what changed for the agent.

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
