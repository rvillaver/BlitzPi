# Diagnostics sources, and the URL-as-path trap

**Where the facts already are** (nothing needs collecting specially):
- `~/.blitz/audit/<ts>-<user>.jsonl` — every security decision; `caller.project_path` says which project. `bash_exec` carries the whole command plus `deletes`/`urls` (best-effort lexical scan, `src/bash-facts.ts`) since 1.2.0; older entries are backfilled from `command` at report time.
- `~/.pi/agent/sessions/--<cwd with / → ->--/*.jsonl` — Pi's session log; every assistant message has `usage` (input/output/cacheRead/cacheWrite/cost). First line is `{type:"session", cwd}` — match on it, not on the dir name.
- `~/.blitz/projects.json` — projects BlitzPi set up (touched on `session_start` when cwd has `.blitz/`).
- Pi's compaction already computes `preparation.fileOps` (read/edited/written Sets) in `session_before_compact`; we copy it to a `compaction` audit entry. Returning anything from that hook replaces Pi's summary — return `undefined`.
- Pi has **no delete and no fetch tool** (tools: bash edit find grep ls read write powershell). Deletions and URLs only ever happen through bash.

**Trap (fixed 1.2.0):** `extractTargets` in `src/bash-guard.ts` matched `//example.com` inside `https://example.com` as a path → zone *other* → out-of-project → the command ran **unconfined** (no bwrap). Any new path regex must strip URLs first. Verify with a headless probe and `jq .confined` on the `bash_exec` entry.

**TUI facts:** pi-tui mouse support only dispatches scrollbar/selection/OSC-8-link clicks (→ `xdg-open`); there is no click handler for components, so "clickable" = OSC-8 link, "inspectable" = a command/`ctx.ui.custom()`. `setHeader` is ignored by Pi 0.84.3 — put hints in the console banner. Pi's `/session` is the built-in usage/cost view; there is no `/status`.

**Install trap (fixed 1.2.2):** the shim ran `current/bin/blitzpi.ts` for everything, so after a rollback to an older version, `blitzpi rollback|versions|use` reached a bin that didn't know them and went to Pi as a *prompt*. Self-service subcommands are now dispatched by the shim to `<app>/install.sh` (newest installer, outside `versions/`). When adding a subcommand that must survive rollbacks, add it to `write_shim` in `install.sh`, not only to `bin/blitzpi.ts`. Verify with `scripts/install-smoke.sh` (fake `0.9.0-old` version).

**Installer transition rule:** `blitzpi update` always runs the *previous* version's app-level installer, so a new installer flag or step (e.g. `--feeds`, the feeds question) only works from the update *after* the one that ships it. Say so in the release notes; the new installer ignores unknown `--options` with a notice (since 1.2.100+) so a newer command never aborts an older installer. The "already the latest version" path must still run `feeds_step`.
