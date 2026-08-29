# Diagnostics sources, and the URL-as-path trap

**Where the facts already are** (nothing needs collecting specially):
- `~/.blitz/audit/<ts>-<user>.jsonl` — every security decision; `caller.project_path` says which project. `bash_exec` carries the whole command plus `deletes`/`urls` (best-effort lexical scan, `src/bash-facts.ts`) since 1.2.0; older entries are backfilled from `command` at report time.
- `~/.pi/agent/sessions/--<cwd with / → ->--/*.jsonl` — Pi's session log; every assistant message has `usage` (input/output/cacheRead/cacheWrite/cost). First line is `{type:"session", cwd}` — match on it, not on the dir name.
- `~/.blitz/projects.json` — projects BlitzPi set up (touched on `session_start` when cwd has `.blitz/`).
- Pi's compaction already computes `preparation.fileOps` (read/edited/written Sets) in `session_before_compact`; we copy it to a `compaction` audit entry. Returning anything from that hook replaces Pi's summary — return `undefined`.
- Pi has **no delete and no fetch tool** (tools: bash edit find grep ls read write powershell). Deletions and URLs only ever happen through bash.

**Trap (fixed 1.2.0):** `extractTargets` in `src/bash-guard.ts` matched `//example.com` inside `https://example.com` as a path → zone *other* → out-of-project → the command ran **unconfined** (no bwrap). Any new path regex must strip URLs first. Verify with a headless probe and `jq .confined` on the `bash_exec` entry.

**TUI facts:** pi-tui mouse support only dispatches scrollbar/selection/OSC-8-link clicks (→ `xdg-open`); there is no click handler for components, so "clickable" = OSC-8 link, "inspectable" = a command/`ctx.ui.custom()`. `setHeader` is ignored by Pi 0.84.3 — put hints in the console banner. Pi's `/session` is the built-in usage/cost view; there is no `/status`.
