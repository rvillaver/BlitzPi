# Project Memory — BlitzPi

Durable learnings for developing BlitzPi itself (one fact per file; skim before real work; verify a named file/flag still exists).

- [BlitzPi launcher facts](blitzpi-launcher-facts.md) — `bin/blitzpi.ts`→`src/launcher.ts` spawns Pi's cli.js with `-e <repo>`; print mode never renders TUI; pty-smoke for TUI verification; macOS sandbox-exec notes; zones + ladder rebuild.
- [Credentials via Pi /login only](credentials-via-pi-login.md) — no API keys in env; at a gate tell the user the exact command, they `/login`.
- [Pi hook & bundle traps](pi-hook-and-bundle-traps.md) — `before_provider_request` can't block; don't bundle the extension; scan only user/tool text.
- [Self-contained installer](self-contained-installer.md) — private Bun + `versions/` + `current` symlink; `ln -sfn` trap; needs a GitHub release; `BLITZPI_SOURCE` for local tests.
- [GoodBehavior: profile is the doctrine](goodbehavior-profile-doctrine.md) — one source of truth injected per adopted project; why the old `.claude/` tree and Python update flow were removed.
- [bwrap --die-with-parent kills under Bun](bwrap-die-with-parent-kills-under-bun.md) — PDEATHSIG is per-thread; sandbox died ~130 ms in; children are tracked + killed on exit instead
- [Per-call governance enforcement](per-call-governance-enforcement.md) — ctx.abort() in before_provider_request enforces; never sendMessage a notice (loops) — appendEntry instead
- [Diagnostics sources & URL-as-path trap](diagnostics-sources-and-url-path-trap.md) — audit + Pi sessions + projects.json are the report sources; URLs must be stripped before path extraction or commands run unconfined; no click handlers in pi-tui
- [Package feed: OSV API, not a dictionary](package-feed-osv-facts.md) — npm has >100k malicious entries (221 MB bundle); only MAL-* ids block; 24 h cache trap in live probes; hook before the bash gate
- [Secrets feed traps](secrets-feed-traps.md) — gitleaks allowlists EXAMPLE keys; EOF is not consent in install.sh; 220/222 rules compile; redact commands in every audit writer
- [Sigma feed facts](sigma-feed-facts.md) — sigma_all_rules.zip (3.2 MB) not core; 121/137 compile; own zip reader; negated filters needing context = no filter; report ledger
- [URLhaus feed facts](urlhaus-feed-facts.md) — no header in the list; 34% is GitHub → exact-URL only for shared platforms; probe with echo (monitor) / curl (enforce, 0 bash_exec)
- [Content scan facts](content-scan-facts.md) — tool_result hook annotates, never blocks; named shapes; annotation marker prevents re-trigger; probe by reading an injected file
- [Listed URLs are antivirus bait](listed-urls-are-antivirus-bait.md) — never write a listed URL in clear (docs, audit, output); defang hxxp://[.]; URL feed stores hashes, no raw source
