# BlitzPi

BlitzPi is the [Pi](https://github.com/earendil-works/pi) coding agent with a security-governance
layer baked in. It is Pi (rebranded to `blitzpi`) launched with the Blitz extension plus a curated set
of Pi packages, so every tool call, LLM call, and shell command runs through access profiles, a
governance gate, a workspace sandbox, threat detection, and an audit trail.

- **No build step.** Pi loads the extension from TypeScript source.
- **Cross-platform bash confinement.** OS isolation on Linux (bubblewrap) and macOS (Seatbelt), with a
  pure-JS scope guard as the fallback everywhere.
- **Credentials via Pi `/login` only** — never API keys in the environment.

## Requirements

- **[Bun](https://bun.sh)** (runtime + package manager; no Node build needed).
- **git**.
- **Git Bash** on Windows (Pi's default shell there).
- Optional: **bubblewrap** (`bwrap`) on Linux for OS-level bash isolation. macOS uses built-in
  `sandbox-exec` (nothing to install). Without an OS sandbox, bash falls back to the scope guard.

## Install & run

One command. It installs BlitzPi **and everything it needs** (a private Bun runtime, Pi, all bundled
packages) into one app directory — nothing else on your machine is touched, no developer tools required:

```bash
curl -fsSL https://raw.githubusercontent.com/rvillaver/BlitzPi/master/install.sh | sh
```

Windows 11 (PowerShell):

```powershell
irm https://raw.githubusercontent.com/rvillaver/BlitzPi/master/install.ps1 | iex
```

It shows you where things go and asks before installing:

| | app directory (runtime + versions) | the `blitzpi` command |
|---|---|---|
| macOS | `~/Library/Application Support/BlitzPi` | `~/.local/bin/blitzpi` |
| Linux | `~/.local/share/blitzpi` (`$XDG_DATA_HOME`) | `~/.local/bin/blitzpi` |

(`BLITZPI_HOME=<dir>` picks another app directory. Windows: `%LOCALAPPDATA%\BlitzPi`, command on the user PATH.)

That private Bun is on `PATH` for the agent inside a session, but **not in your own shell** — rather than exporting a
platform-specific path, reach it through the command: **`blitzpi bun <args>`** runs it (`blitzpi bun install`,
`blitzpi bun run dev`), and **`blitzpi paths`** prints where it and everything else lives.

Then open a new terminal and run `blitzpi`. First time: `/login` inside the session to sign in to a
provider (stored in `~/.pi/agent/auth.json`).

```bash
blitzpi update      # installs the newest release as a whole; the previous one stays installed
blitzpi versions    # what is installed (current + previous marked)   ·   BLITZPI_KEEP=3 keeps more
blitzpi rollback    # switch back to the previous version — instant, offline (run again to return)
blitzpi use 1.2.0   # switch to any installed version; `blitzpi update --version v1.2.0` fetches one that isn't
blitzpi uninstall   # removes the app directory + command; keeps your logins (~/.pi) and audit (~/.blitz)
blitzpi uninstall --purge   # …and also removes ~/.blitz (audit trail, global config)
blitzpi --version   # blitzpi x.y.z (pi 0.84.3, bun 1.4.0)
blitzpi bun <args>  # run the private Bun this install ships — `blitzpi bun install`, `blitzpi bun run dev`
blitzpi paths       # where everything lives (app dir, current version, the bundled bun, the command itself)
```

### Developers (from source)

```bash
git clone https://github.com/rvillaver/BlitzPi && cd BlitzPi
bun install            # installs Pi + packages AND applies the rebrand patch (patches/)
bun link               # puts `blitzpi` on PATH (~/.bun/bin)
blitzpi                # interactive agent (Pi TUI + Blitz security layer)
```

Release = tag + GitHub release: `git tag vX.Y.Z && git push --tags && gh release create vX.Y.Z --generate-notes`
(the installer reads `releases/latest`; the tag's source tarball is what users install, so `bun.lock` and
`patches/` must be committed). `bash scripts/install-smoke.sh` tests install → run → update → uninstall
in a throwaway HOME.

## Commands

```bash
blitzpi                 # interactive
blitzpi -p "prompt"     # print mode (one answer, exit)
blitzpi --help          # all Pi flags/subcommands pass through
blitzpi audit           # query the audit trail (--project PATH, --type, --prune for housekeeping)
blitzpi report [PATH]   # one project across sessions: files read/written/deleted, URLs, commands, governance, usage
blitzpi projects        # projects managed by BlitzPi (prune | forget PATH)
blitzpi feeds           # detection feeds: status · opt-in | opt-out · update | list | rollback <feed> · scan <text> · check <pkg…> · parse <command>
blitzpi level [tier]    # security level: strict | guarded | monitored (--global for a machine-wide default)
blitzpi bridge          # chat bridge daemon: start | stop | status | bind <platform:id> | post | ask | model
blitzpi demo            # capability demo (writes it from real runs)
```

Inside the session: `/blitz-security` (every layer, its mode, this session's counters — `/blitz-security files | bash |
governance | all` lists what the counters count), `/blitz-report` (this project's diagnostics), `/blitz-level` (the
security tier), `/blitz-bridge` (chat bridge setup/status — see below), `/session` (Pi's usage and
cost for this session), `/login`, `/model`, `/theme`, `/adopt-goodbehavior`, `/unadopt-goodbehavior`.

### Three ways to talk to BlitzPi, not one

These look similar (a `/` command, or a bare word) but come from three different mechanisms in Pi, each with its own
rules for who can invoke it:

| Form | What it is | Who can invoke it | Examples |
|---|---|---|---|
| `/blitz-*` | An extension command BlitzPi registers directly | A human, or the agent as part of its own turn | `/blitz-security`, `/blitz-level`, `/blitz-bridge` |
| GoodBehavior (or bundled) skill | Doctrine the agent follows | The agent, on its own, whenever a request matches — this is the normal path, no command needed | "audit this project's gaps" |
| `blitzpi <word>` | A real CLI subcommand, run like any other shell command | The agent via its bash tool, or a human in a terminal | `blitzpi bridge status`, `blitzpi level strict` |

`/blitz-bridge setup discord` is the one command that must be typed by a human directly — it asks for the bot token
privately, and that prompt only exists in an interactive session; the agent has no way to run it on your behalf.

BlitzPi ships **seven GoodBehavior skills** (`audit-`, `roadmap-`, `gate-build-`, `verify-`, `learn-`, `uatplan-`,
`draft-profile-goodbehavior`) plus **`bridge`** — the agent invokes any of them on its own when a request matches;
that's the intended, normal path, doctrine the agent is meant to follow autonomously. Anything else your session
lists under `[Skills]` that isn't one of these eight is a bundled third-party extension's skill, not BlitzPi's own.

**Security feeds are opt-in and separate from the platform.** BlitzPi asks once at start (in the TUI) while you have not
decided — *Yes* installs them on the spot, *Not now* asks again after the next update, *No* records an opt-out; the installer
asks too, at install and at update. The platform always updates, the feeds only when you say so (`--feeds` / `--no-feeds`
answer the installer without a prompt; `blitzpi feeds opt-in | opt-out` any time). Downloads show progress; `blitzpi feeds list`
shows *downloaded → stored* per feed and the total on disk (≈ 2 MB with the previous copies kept for rollback). Feeds live in `~/.blitz/feeds/` (≈ 0.2 MB compiled), each with a
manifest (source, sha256, fetched time), the previous version for `blitzpi feeds rollback <feed>`, and an audit entry per
update. Not opted in: the feed layers show `off (not installed)`; the OSV package check and the built-in patterns keep
working with nothing downloaded.

**Where the diagnostics live** — all per user, in your home, never in the project: `~/.blitz/audit/` (one `.jsonl` per
session, every security decision, tagged with the project), `~/.blitz/projects.json` (the projects BlitzPi has set up),
`~/.pi/agent/sessions/` (Pi's own session logs, with token usage). `blitzpi report` folds the three together.

The seven GoodBehavior skills sync into `.pi/skills/` **automatically, every session** — active from the first
`blitzpi` invocation in any project, no `/adopt-goodbehavior` command and no restart. On first run in a new folder,
BlitzPi asks to **set it up as a project** (trust + `.blitz/` marker); the current directory is then your workspace
(the security anchor). BlitzPi's own install directory is off-limits infrastructure. Saying yes also seeds the
project's own *profile* (`.blitz/goodbehavior/profiles/<name>.md`: verify level, audit lenses, where files live) —
the only part of GoodBehavior that's a deliberate, per-project choice, injected into the agent's instructions on
every turn alongside the invariant doctrine (`.pi/goodbehavior/doctrine.md`: the loop, what "done" means, honesty,
reuse — the same for every project regardless of profile). The shipped default is `development`; four core profiles
ship (`development`/`analysis`/`research`/`creative`, `.pi/goodbehavior/profiles/INDEX.md`), and the agent asks what
this project actually is and matches, composes, or drafts a custom one right after adopting
(`draft-profile-goodbehavior`) instead of leaving the generic default in place. Edit the profile directly any time
to change how the agent works in that project.
`/adopt-goodbehavior` again = update the profile from the installed version (files you edited are kept and listed);
`/unadopt-goodbehavior` removes it, reverting to the generic default (memory kept unless you choose otherwise) —
skills are unaffected either way, they keep syncing regardless.

## Security layers

| Layer | Enforced by | What it does |
|---|---|---|
| Security level | `permission_gate` + `tool_call` hooks | how much BlitzPi stops to ask: `strict` (also asks before every package install), `guarded` (default, today's ladder), `monitored` (in-project writes and outside-project reads go silent — still audited; governance and the secrets/URL feeds default to `monitor` unless set explicitly). A known-malicious package is blocked and a write outside the project or a dangerous shape still prompts, in every tier. A non-interactive run always uses `guarded`. `blitzpi level [tier] [--global]` or `/blitz-level`; asked once per project at first run |
| Access profiles | `tool_call` hook → block | allow/deny tools per `.blitz/profiles/*.yaml` |
| File sandbox | `tool_call` hook → block | confine read/write/edit/grep/find/ls to the workspace |
| Bash sandbox | `bash` tool override + guard | confine shell — see below |
| Governance gate | `input` event → block; `before_provider_request` → abort | stop a prompt (injection / disallowed model) before a turn; check every model call with the governance provider and **stop** denied ones (`governance.mode: enforce`, default) or only record them (`monitor`) |
| Threat detection | `tool_call` hook → block | pattern-based injection/PII detection on tool inputs |
| Content injection scan | `tool_result` hook → annotate | **monitor only**: every tool result the agent reads (files, command output, pages) is scanned for instruction-shaped text ("ignore previous instructions", "note to the AI:", "run this command:" …). A hit is audited (shape names + a short sample, never the content), shown, and the result is annotated so the model treats the text as data. Never blocked — files legitimately contain such phrases. `threat_detection.content: monitor \| off` |
| Secrets feed (gitleaks) | `tool_call` hook → record / block | **opt-in download** (`blitzpi feeds opt-in`): the 220 gitleaks rules, compiled locally; a credential literal in a shell command is blocked (`feeds.secrets: enforce`, default since 1.2.106) or recorded and shown (`monitor`). The secret is never written to the audit trail — flagged credentials are redacted in every audited command |
| Command shapes (Sigma) | `tool_call` hook → record / block | **opt-in download**: SigmaHQ's Linux/macOS process-creation rules (121 of 137 compile — the rest need parent-process context; counted in the manifest) evaluated on every shell command: reverse shells, base64-to-shell, persistence, discovery. `feeds.commands: monitor` (default) records and shows; `enforce` blocks. `blitzpi report` lists hits per rule so the false-positive rate is known before enforce |
| Malicious URLs (URLhaus) | `tool_call` hook → record / block | **opt-in download**: abuse.ch URLhaus's online list (~15,000 URLs, hourly). A URL in a command that is listed is blocked before the command runs (`feeds.urls: enforce`, default since 1.2.106) or recorded (`monitor`) — nothing is fetched. Dedicated hosts and IPs match by host; shared platforms (GitHub, Drive, Dropbox, Discord …) match by exact URL only, because a third of the list lives on GitHub |
| Bun install policy | sandbox env → Bun | `feeds.min_release_age` (default 3 days): inside the sandbox Bun never selects a version published more recently than that; after each Bun install the tool output lists packages whose install scripts Bun refused and the tree's advisories (`bun audit`), audited as `install_policy` |
| Package feed (OSV) | `tool_call` hook → block | every package an install command names (`bun add`, `npm i`, `npx`, `pip install`, `cargo add`, `gem install`, `go get`) is checked against [osv.dev](https://osv.dev) before it runs; a known-malicious package (OSV `MAL` id) is blocked (`feeds.packages: enforce`, default) or recorded and shown (`monitor`). Advisories on legitimate packages (GHSA/CVE) never block. Answers are cached 24 h in `~/.blitz/feeds/`; an unreachable feed never blocks — the outage is audited |
| Audit trail | all layers | JSONL decisions in `.blitz/audit/` |

### Bash confinement per OS

`config.sandbox.backend: auto` selects the best available:

| OS | Backend | Isolation |
|---|---|---|
| Linux | `bwrap` | OS-level (workspace = only writable path) |
| macOS | `sandbox-exec` (built-in) | OS-level (writes confined to workspace) |
| any / fallback | `pinned` + guard | scope guard: classify allow / confirm / deny + audit (not OS-isolated) |
| Windows | *guard only today* | AppContainer backend planned |

The guard runs on every OS regardless of backend: it classifies each command and prompts the user
(`confirm`) or blocks (`deny`) for out-of-scope actions. It is scope enforcement + approval + audit, not
adversarial isolation — that is what the OS backends provide.

## Configuration

`.blitz/blitz.config.yaml` — `security_level` (`strict` / `guarded` / `monitored`), threat tier, audit path,
default profile, `sandbox.run_dir` / `backend`, governance provider (`local` default, no server). A project's
config overrides individual fields on top of `~/.blitz/blitz.config.yaml` (a global default), not instead of it.
`.blitz/profiles/*.yaml` — access profiles.

## Test

```bash
bun run test               # jest unit/integration suite
BLITZ_E2E=1 bun run test   # + real `blitzpi -p` enforcement tests (needs a login)
bash scripts/smoke-test.sh # end-to-end install check (prints PASS/FAIL + the commit it ran)
```

## Security model

BlitzPi is the normal Pi coding flow plus an invisible security layer. Every file/shell action is
classified into a **zone** (project / system / other / …) and resolved on a **permission ladder**
(silent / ask [Yes / No / Always-session / Always] / dangerous-with-red-warning). Audit is global
(`~/.blitz/audit`); project policy lives in `<project>/.blitz`. See **docs/SECURITY-ZONES.md**.

## Enhance

- Architecture, key files, extension points, and contributor gotchas: **docs/ARCHITECTURE.md**.
