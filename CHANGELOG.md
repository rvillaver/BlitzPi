# Changelog

Governance changes are called out explicitly in every release: what the runtime enforces, what it merely observes, and what changed for the agent.

## 1.2.113 — 2026-08-31

- **Bridge: a dead run never blocks a channel.** `stop` clears a run whose agent process is already gone; a mention into such a run clears it and starts fresh instead of "Could not queue that: rpc child is not running".
- **`blitzpi bridge restart` / `shutdown`** — restart or stop the daemon (detached; log `~/.blitz/bridge/daemon.log`); `blitzpi bridge stop` aborts a conversation's run, as before. `/blitz-bridge restart` in a session does the same. A second `bridge start` now says which of the two you probably meant.

## 1.2.112 — 2026-08-31

- **A command ends when its shell ends.** A backgrounded process (`bun run dev &`, `sleep 120 &`, even detached with output redirected) used to keep the bash tool call open until the run was aborted — under bwrap the sandbox waits for every process, elsewhere the leftovers held the output pipes. Now the shell's exit ends the command and whatever it left behind is terminated with it (the documented rule: start a server and probe it in the same command). Commands without a timeout are capped at 10 minutes (exit 124, with an explanation in the output).
- **Bridge:** steering a run that has shown no activity for 5+ minutes gets a hint that `stop` aborts it; when the agent process stops while a run is open (idle stop, crash), the run is closed out and said so instead of staying "running" forever; changing a channel's settings no longer detaches its live session.

## 1.2.111 — 2026-08-30

- **Chat bridge — one project, one conversation.** Binding refuses a project directory that is already bound to another channel (two agents in one working directory would race on files and git state); rebinding the same channel to change its settings still works, and `force` overrides for deliberate cases. Inside a channel's shared thread, operators need no mention: a message there steers the current run or starts the next one.

## 1.2.110 — 2026-08-30

- **Chat bridge — one thread per channel, answers in the channel.** Runs no longer open a thread per request. Each channel gets one shared work thread (`blitzpi · <project>`, reused) and a `threads` setting: `answer` (default) — tool activity and the closing summary in the thread, the answer in the channel as a reply to your mention, files alongside it; `on` — everything in the thread with `▶ started` / `✅ done —` lines in the channel; `off` — everything in the channel. `/blitz threads <mode>` in Discord, `/blitz-bridge threads <mode>` in a session.
- **Bridge daemon** refuses to start twice on the same machine (a second gateway connection on one bot token made every button race).

## 1.2.109 — 2026-08-30

- **Chat bridge — file transfer.** Attachments on a triggering message are fetched into `<project>/.blitz/transfer/in/` and named in the prompt; anything the agent saves under `.blitz/transfer/out/` (during the run or by its end) is posted to the thread as an attachment, once per content. The transfer directory is workspace space (no security-config prompt) and git-ignores itself. Project writes still go through the write ladder — in Discord the "allow this write?" prompt appears as buttons for operators, and "Always" remembers it for the project.

## 1.2.108 — 2026-08-30

- **Chat bridge — Discord.** `blitzpi bridge start` now runs a Discord bot when `~/.blitz/bridge/discord.token` (or `BLITZ_DISCORD_TOKEN`) exists. Bind a channel to a project (`/blitz-bridge bind #channel` inside a session, `/blitz bind <dir>` in Discord, or `blitzpi bridge bind discord:#channel <dir>`): members chat freely; `@blitzpi …` starts a governed run in a thread — tool activity and the answer stream in as new messages (never edited), Blitz's own prompts (dangerous writes, the `question` tool) appear as buttons only operators can press, security notices show as ⚠ lines, and `✅ done` closes the run. `@blitzpi stop` / `/blitz stop` abort immediately. `/blitz status|new|trigger|activity|context|operators` tune a channel; the guild owner is the default operator. The `bridge` skill walks a user through the Discord portal setup. Every bridge prompt records who asked (`on_behalf_of`). Telegram and Slack adapters follow; file transfer is next.
- **Windows (preview, being verified):** `install.ps1` — one line in PowerShell installs a private Bun and BlitzPi under `%LOCALAPPDATA%\BlitzPi` with `blitzpi` on the user PATH; `blitzpi update|versions|rollback|use|uninstall` work through it. Zones understand Windows paths (drive letters, backslashes, case). The `pinned` backend (PowerShell, cwd/HOME pinned) is the guard-level confinement today; AppContainer isolation follows.

## 1.2.107 — 2026-08-30

- **`question` tool.** The agent can ask you to pick from short options (or type an answer) — a picker in the TUI, buttons over the RPC bridge. In print/JSON mode it says no one is there to answer instead of guessing.
- **Chat bridge, phase 1 (plumbing; no chat platform yet).** `blitzpi bridge run [--project DIR] "<prompt>"` runs a governed request and streams tool activity and the answer to the terminal; `blitzpi bridge start` is the daemon with a local control socket (`~/.blitz/bridge/bridge.sock`, 0600) and `blitzpi bridge post|ask|stop|status|projects|bind|unbind` talk to it. Inside a bridge-hosted run the agent has a `channel_post` tool (gated like any tool; only present under the daemon). Every bridge prompt names its human (`[caller platform:id#name]`) and the audit records it as `on_behalf_of`. Discord/Telegram/Slack adapters follow.
- **Headless output is clean.** In `-p`, `--mode json` and `--mode rpc`, Blitz's startup lines go to stderr — stdout carries only the answer / JSONL.

## 1.2.106 — 2026-08-30

- **Bun install policy inside the sandbox.** `feeds.min_release_age` (default `3d`; `off`) — Bun does not select a version published more recently than that (the "malicious version published an hour ago, pulled after a day" window OSV cannot know yet). The policy travels as a BlitzPi-owned `.bunfig.toml` via `XDG_CONFIG_HOME`; the project is untouched. After every Bun install the tool output ends with `[Blitz] install policy: …` — packages whose lifecycle scripts Bun refused to run (with the `bun pm trust` hint) and the tree's advisories by severity (`bun audit`) — audited as `install_policy`. Cache and policy env now override whatever the launching shell exports.
- **Governance: the secrets and URL feeds now enforce by default** (`feeds.secrets: enforce`, `feeds.urls: enforce`). Measured before the flip: across the trails on both development machines every `feed_secret` and `feed_url` entry was a deliberate probe — no false positive on real work — while the Sigma command-shapes feed fired on ordinary commands (`touch -t`, `grep password`) and therefore **stays in `monitor`**; use `feeds.allow` to accept its known false positives per project, then set `feeds.commands: enforce` yourself. A project that set a mode explicitly keeps it. Feeds that are not installed stay off — the opt-in is unchanged.

## 1.2.105 — 2026-08-30

- **A download's output file is a write.** `curl -o F` / `--output F` and `wget -O F` / `-o F` / `--output-document F` are gated as writes to `F` (previously reads), so `wget -O ~/.bashrc …` or `curl -o /etc/… ` hits the write ladder. curl's `-O` (remote name into the cwd) and `-o -` (stdout) are not paths.
- **`blitzpi feeds update --force` on unchanged content** is reported as `unchanged` (a recompile) and no longer replaces the previous copy with a clone of the current one; `blitzpi feeds rollback` onto an identical copy says "nothing to roll back" instead of swapping a feed with itself.

## 1.2.104 — 2026-08-30

- **Threat detection never rewrites tool input.** Tier ≤ 2 replaced e-mail addresses inside a `bash` command with `[REDACTED_EMAIL]` before execution (`$[…]` is arithmetic in bash, so `user$ts@example.com` ran as `user0`). Removed: PII in a command is observed and audited (`pii_observed`), never edited; the audit writer still redacts.
- **Bash guard precision.** "Download piped into a shell" no longer fires across a statement boundary (`x=$(curl …); printf "$x" | perl` is not `curl | sh`). Relative paths resolve against the directory a `cd` moved the statement into (`(cd apps/api && … > ../../.tmp/x.log)` is a project write), also inside subshells; `)` is no longer part of a redirect target.
- **An approved out-of-project path keeps the OS sandbox.** Approving a read or write outside the workspace used to run the *whole command* unconfined. Now the backend opens exactly the approved paths (bwrap `--bind`/`--ro-bind`, Seatbelt `file-write*` subpath) and the command stays confined; `bash_exec` records `grants`. Only an approved dangerous *shape* (sudo, download|shell, reverse shell) runs unconfined, and the prompt says so; `bash_exit` is recorded for those runs too.
- **Toolchain caches under the sandbox** — `sandbox.cache: shared | project | off` (default `shared`). Package managers are routed into `~/.blitz/cache/<tool>` (`BUN_INSTALL_CACHE_DIR`, `npm_config_cache`, `YARN_CACHE_FOLDER`, `npm_config_store_dir`, `XDG_CACHE_HOME`, `PIP_CACHE_DIR`, `UV_CACHE_DIR`, `GOCACHE`, `GOMODCACHE`), which every confined command may write. Before: on macOS `bun install` failed in ~40 ms because `BUN_INSTALL` pointed the cache at the real home (denied); on Linux the cache landed on a throwaway tmpfs and was re-downloaded every command. Host caches (`~/.bun`, `~/.npm`, …) are never opened.
- **Repository:** the public repo now carries the product only — historical scaffolding at the root removed; internal planning notes no longer ship in the version tarball.
- **Per-rule feed allowlist** — `feeds.allow: [rule ids]` in `.blitz/blitz.config.yaml`: hits of an accepted Sigma or gitleaks rule are neither recorded nor shown; `/blitz-security` shows the count. Rule ids are in the audit (`feed_command.hits[].id`, `feed_secret.hits[].id`) and `blitzpi report`.

## 1.2.103 — 2026-08-30

### Install
- **Feed downloads show progress and sizes.** In the TUI the status bar shows `⬇ commands 1.4 MB / 3.0 MB (46%)` while feeds install; in the shell `blitzpi feeds update` draws a per-feed progress bar. Every completion line and `blitzpi feeds list` report *downloaded → stored* per feed (e.g. Sigma: 3.0 MB downloaded → 203 KB stored; URLhaus: 1.3 MB → 709 KB hashed) plus the total on disk (current + previous copies, OSV cache); `blitzpi feeds status` and `/blitz-security` show the total too. The manifest records `stored_bytes`. Servers usually gzip these lists, so `Content-Length` is the wire size, not the received size — progress shows a percentage only for identity responses and bytes-only otherwise.
- Test hygiene: two test suites had been failing to *compile* (type errors after `regex` became optional and `.at()` under the ES2020 lib) without showing up as test failures in the checks I ran; 13 tests were not executing. Fixed, and the suite-level line is now part of every check.

## 1.2.102 — 2026-08-30

### Install
- **BlitzPi now asks about security feeds itself.** On macOS, `blitzpi update` never offered the feeds: the installer only asked machines that had *already* opted in, and every update runs the previous version's installer anyway, so an installer-side question reaches a machine one release late or never. Now the app asks — once per version, at session start in the TUI, while no decision is recorded: **Yes** installs the feeds right there (they are active immediately; the hooks re-read rules when a feed changes, so no restart), **Not now** asks again after the next update, **No — don't ask again** records an opt-out (`blitzpi feeds opt-in` reverses it). The installer also asks whenever the machine is undecided (install *and* update), records an explicit "no" as opt-out, and never treats a non-answer as a decision. `blitzpi feeds status` shows "not decided" / "declined".
- Feed hooks register even before a feed is installed and pick the feed up the moment it appears (opt-in, update, rollback) — no restart.

## 1.2.101 — 2026-08-30

### Governance
- **Listed URLs never appear in clear — antivirus was quarantining them.** After `blitzpi update` on macOS the antivirus flagged `docs/plans/ROADMAP.md` inside the installed version: it carried a live URLhaus URL as probe evidence, and antivirus engines consume URLhaus too. The URL feed would have done the same at scale (15k listed URLs in plain text under `~/.blitz/feeds/urls/`). Now: the URL feed stores **128-bit hashes** of normalised URLs and hosts (matching hashes what it sees), the raw download is never kept for any feed (rollback uses the previous compiled rules; stale `source.raw` files from 1.2.100 are removed on the next update), and every place a listed URL is written or shown — audit `feed_url` hits, audited commands, the block reason, TUI notices, `blitzpi feeds scan`, docs — uses the **defanged** form (`hxxp://`, `[.]`). The installer smoke test now proves nothing under `~/.blitz/feeds` carries a listed host in clear.

### Install
- Installer: `blitzpi update` on an already-current platform still offers/refreshes the security feeds (it used to exit before the feeds step); unknown `--options` are ignored with a notice instead of aborting, so a newer command can pass flags an older installer predates.

## 1.2.100 — 2026-08-30

### Governance
- **Package feed (OSV) — detection that updates itself.** Every `bash`/`powershell` call that installs packages (`bun|pnpm|yarn add`, `npm i`, `npx`/`bunx`, `pip|pipx|uv pip install`, `poetry|uv add`, `cargo add|install`, `gem install`, `go get|install`) is checked against osv.dev before it runs. A known-malicious package (an OSV `MAL-*` entry — >100,000 npm packages alone, maintained by OpenSSF) is **blocked** under `feeds.packages: enforce` (the default) with the OSV id and summary in the reason; `monitor` records and shows it; `off` disables. Advisories on legitimate packages (GHSA/CVE) never block — they need the resolved version, parked in the backlog. Verdicts are cached 24 h (`~/.blitz/feeds/osv-cache.json`); an unreachable feed never blocks — the install proceeds and `feed_unreachable` is audited, the same rule as governance outages. The feed hook runs before the bash gate, so a malicious install is refused, not asked about. New layer "Package feed (OSV)" in the banner and `/blitz-security`; `/blitz-security packages` lists this session's hits; `blitzpi feeds status | check <pkg…> | parse <command> | clear-cache`. Why an API and not a pulled dictionary: OSV's npm bundle is 221 MB and the ossf repo 273 MB — the dictionary *is* osv.dev.

- **Feed store + secrets feed (gitleaks) — opt-in, separate from the platform.** Security feeds are a user's choice: the installer asks (`Install security feeds now?`), `blitzpi update` asks again only if you opted in, and a non-answer is never consent (EOF/CI = no; `--feeds` / `--no-feeds` decide silently). Platform updates always go through. Feeds live in `~/.blitz/feeds/<name>/` with a manifest (source, ETag, sha256 of the download, fetched time, rule counts), the previous version kept for `blitzpi feeds rollback <feed>`, and a `feed_update` / `feed_rollback` / `feed_update_failed` audit entry per action; a download that fails to compile leaves the previous feed in place. First feed: **secrets** — the gitleaks rule set (220 of 222 rules compile to JS; the 2 skipped are counted in the manifest), keyword-prefiltered. A credential literal in a `bash`/`powershell` command is recorded and shown (`feeds.secrets: monitor`, the default) or blocked (`enforce`). **The secret is never written to the audit trail**: hits carry the rule id and a redacted sample, and every audited command (`bash_exec`, `bash_exit`, `feed_check`, `permission_check`) has flagged credentials redacted. `blitzpi feeds opt-in | opt-out [--remove] | update [--force] | list | rollback <feed> | scan <text>`; new layer "Secrets feed (gitleaks)" shows `off (not installed)` until opted in. `smol-toml` (already in Pi's tree) is now a declared dependency.

- **Command-shapes feed (Sigma) — opt-in.** The `commands` feed pulls SigmaHQ's release bundle (`sigma_all_rules.zip`, 3.2 MB monthly; only the Linux/macOS process-creation rules are kept, ~130 KB compiled — Detection Rule License 1.1, attribution kept per rule) through a dependency-free zip reader. 121 of 137 rules compile; the 16 that need parent-process/user context are skipped and counted. Evaluation runs on the command line only (`CommandLine`, and `Image` = the executables the command names); a `not filter_*` that needs missing context is treated as "no filter" — more hits, never fewer — which is why the feed starts in `monitor`. Hits are audited as `feed_command` (rule id, title, severity) and shown; `feeds.commands: enforce` blocks. `blitzpi feeds scan` runs every installed feed; `blitzpi report` now prints a **feed-hit ledger** (rule → count, blocked count) — the false-positive measure to read before turning any feed to enforce. New layer "Command shapes (Sigma)".

- **Malicious-URL feed (URLhaus) — opt-in.** The `urls` feed pulls abuse.ch's `text_online` list (CC0, ~15,000 URLs, 1.3 MB, hourly) into two sets: every exact URL, and hosts — except shared platforms. Measured before building: 34% of the list is `raw.githubusercontent.com` / `github.com` (plus Drive, Docs, OneDrive, Dropbox, archive.org), so those match by exact URL only; IPs and dedicated domains (the bulk) match by host. Every URL a `bash`/`powershell` command names is checked; `feeds.urls: monitor` (default) records `feed_url` and shows it, `enforce` blocks before the command runs — a listed URL is never fetched. `blitzpi feeds scan` and the report ledger cover it. New layer "Malicious URLs (URLhaus)".

- **Content-side injection scan (monitor only).** Injection reaches a coding agent through what it *reads*, not the user's prompt. Every text tool result (`read`, `bash` output, fetched pages …, first 200 KB) is scanned for 12 named instruction shapes — `ignore-instructions`, `to-the-ai`, `you-are-now`, `run-command-instruction`, `exfiltrate`, `hidden-instruction-marker` …. A hit is audited as `content_injection` (tool, target, shape names, a ≤100-char sample — never the content), shown in the TUI, and the tool result is annotated with a one-line note telling the model the text is data, not instructions. Nothing is blocked: files legitimately contain such phrases. New layer "Content injection scan"; `/blitz-security content`; shapes appear in the report ledger. `threat_detection.content: monitor | off`. A pulled *corpus* of jailbreak phrases is parked (see backlog): no maintained, small, licence-clear list exists that would beat these shapes without a classifier model.

### Updating from 1.2.3 or earlier
- The first `blitzpi update` runs the *previous* version's installer, which does not know the feeds question or `--feeds`; the platform updates normally and the question appears from the next update on. Run `blitzpi feeds opt-in` any time to install the feeds directly.

### Other
- Versioning: this starts the **1.2.1xx** series (three-digit patch, minor stays at 2). Pushes are not releases; a release is cut when a set of improvements is complete.

## 1.2.3 — 2026-08-30

### Install
- **Bootstrap for copies installed by an older installer.** Updating 1.2.1 → 1.2.2 ran 1.2.1's installer, which does not place the app-level installer or the routing command, so 1.2.2's fix would only have landed on the *following* update. Now the first self-service command (`versions`, `rollback`, `use`, `update`, `uninstall`) run from a version whose app directory lacks `<app>/install.sh` performs `install.sh --refresh` first: copies its installer to the app level and rewrites the command. `--use`/`--rollback` also rewrite the command every time (idempotent).

## 1.2.2 — 2026-08-30

### Install
- **`rollback` / `versions` / `use` / `update` / `uninstall` work whichever version is current.** Found live: after `blitzpi rollback` to 1.2.0, a second `blitzpi rollback` reached 1.2.0's own command, which does not know the word — it went to Pi as a prompt and the model answered it. The command now routes self-service subcommands to an app-level copy of the newest installer (`<app>/install.sh`, refreshed on every install/update, kept outside `versions/`), so an older version being current cannot take them away. Covered by the install smoke test with a fake old version.

## 1.2.1 — 2026-08-30

### Install
- **Rollback is a command.** `blitzpi rollback` switches `current` back to the version you updated from — instant and offline (it just repoints the symlink and re-runs the self-check); run it again to return. `blitzpi versions` lists what is installed with the current and previous marked; `blitzpi use <version>` switches to any installed one. Before, the "previous version kept for rollback" could only be used by hand (`ln -sfn`).
- `blitzpi update --version vX.Y.Z` switches to that version if it is already installed instead of downloading it again (`--reinstall` forces a download).
- `BLITZPI_KEEP` (default 2) sets how many installed versions stay; the new one and the one you left are never removed.
- Versioning from here on: three-digit patch numbers — the next release is 1.2.100, then 1.2.101, … Pushes are not releases; a release is cut when there is an improvement worth a `blitzpi update`.

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
