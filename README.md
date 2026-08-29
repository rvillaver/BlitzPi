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

It shows you where things go and asks before installing:

| | app directory (runtime + versions) | the `blitzpi` command |
|---|---|---|
| macOS | `~/Library/Application Support/BlitzPi` | `~/.local/bin/blitzpi` |
| Linux | `~/.local/share/blitzpi` (`$XDG_DATA_HOME`) | `~/.local/bin/blitzpi` |

(`BLITZPI_HOME=<dir>` picks another app directory. Windows: not yet — a PowerShell installer is planned.)

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
blitzpi demo            # capability demo (writes it from real runs)
```

Inside the session: `/blitz-security` (every layer, its mode, this session's counters — `/blitz-security files | bash |
governance | all` lists what the counters count), `/blitz-report` (this project's diagnostics), `/session` (Pi's usage and
cost for this session), `/login`, `/model`, `/theme`, `/adopt-goodbehavior`, `/unadopt-goodbehavior`.

**Where the diagnostics live** — all per user, in your home, never in the project: `~/.blitz/audit/` (one `.jsonl` per
session, every security decision, tagged with the project), `~/.blitz/projects.json` (the projects BlitzPi has set up),
`~/.pi/agent/sessions/` (Pi's own session logs, with token usage). `blitzpi report` folds the three together.

On first run in a new folder, BlitzPi asks to **set it up as a project** (trust + `.blitz/` marker); the
current directory is then your workspace (the security anchor). BlitzPi's own install directory is
off-limits infrastructure. Saying yes also **adopts GoodBehavior** into the project: six skills in `.pi/skills/`
and the doctrine — the active *profile* (`.blitz/goodbehavior/profiles/development.md`: the loop, what "done" means,
verify level, audit lenses, where files live) — which BlitzPi injects into the agent's instructions on every turn.
Edit the profile to change how the agent works in that project. `/adopt-goodbehavior` again = update from the
installed version (files you edited are kept and listed); `/unadopt-goodbehavior` removes it (memory kept unless
you choose otherwise).

## Security layers

| Layer | Enforced by | What it does |
|---|---|---|
| Access profiles | `tool_call` hook → block | allow/deny tools per `.blitz/profiles/*.yaml` |
| File sandbox | `tool_call` hook → block | confine read/write/edit/grep/find/ls to the workspace |
| Bash sandbox | `bash` tool override + guard | confine shell — see below |
| Governance gate | `input` event → block; `before_provider_request` → abort | stop a prompt (injection / disallowed model) before a turn; check every model call with the governance provider and **stop** denied ones (`governance.mode: enforce`, default) or only record them (`monitor`) |
| Threat detection | `tool_call` hook → block | pattern-based injection/PII detection on tool inputs |
| Audit trail | all layers | JSONL decisions in `.blitz/audit/` |

### Bash confinement per OS

`config.sandbox.backend: auto` selects the best available:

| OS | Backend | Isolation |
|---|---|---|
| Linux | `bwrap` | OS-level (workspace = only writable path) |
| macOS | `sandbox-exec` (built-in) | OS-level (writes confined to workspace) |
| any / fallback | `pinned` + guard | scope guard: classify allow / confirm / deny + audit (not OS-isolated) |
| Windows | *guard only today* | AppContainer backend planned (see docs/BACKLOG.md) |

The guard runs on every OS regardless of backend: it classifies each command and prompts the user
(`confirm`) or blocks (`deny`) for out-of-scope actions. It is scope enforcement + approval + audit, not
adversarial isolation — that is what the OS backends provide.

## Configuration

`.blitz/blitz.config.yaml` — threat tier, audit path, default profile, `sandbox.run_dir` / `backend`,
governance provider (`local` default, no server). `.blitz/profiles/*.yaml` — access profiles.

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
- What's next and deferred work: **docs/BACKLOG.md**.
- Development workflow / operating principles: **CLAUDE.md**.
