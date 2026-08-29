# Project Memory — BlitzPi

Durable learnings for developing BlitzPi itself (one fact per file; skim before real work; verify a named file/flag still exists).

- [BlitzPi launcher facts](blitzpi-launcher-facts.md) — `bin/blitzpi.ts`→`src/launcher.ts` spawns Pi's cli.js with `-e <repo>`; print mode never renders TUI; pty-smoke for TUI verification; macOS sandbox-exec notes; zones + ladder rebuild.
- [Credentials via Pi /login only](credentials-via-pi-login.md) — no API keys in env; at a gate tell the user the exact command, they `/login`.
- [Pi hook & bundle traps](pi-hook-and-bundle-traps.md) — `before_provider_request` can't block; don't bundle the extension; scan only user/tool text.
- [Self-contained installer](self-contained-installer.md) — private Bun + `versions/` + `current` symlink; `ln -sfn` trap; needs a GitHub release; `BLITZPI_SOURCE` for local tests.
- [GoodBehavior: profile is the doctrine](goodbehavior-profile-doctrine.md) — one source of truth injected per adopted project; why the old `.claude/` tree and Python update flow were removed.
