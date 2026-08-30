# Backlog — feature priority list

Everything not on an active roadmap, in one ordered list. The core product (rebranded Pi + governance + cross-platform bash
confinement + updatable detection feeds, 1.2.100) is built and verified on Linux and macOS. Effort: **S** < half a day,
**M** 1–3 days, **L** a week or more / needs hardware. Roadmapping an item = `/roadmap-goodbehavior` on it.

## P0 — cheap, closes a real gap now
| # | Item | Why | Effort | Blocker / note |
|---|---|---|---|---|
| 1 | **Bash guard: `curl -o`, `wget -O`, `--output` paths are writes** | today the output path is classified as a read, so `wget -O ~/.bashrc …` is gated as a read of `~` | S | none — one line in `WRITE_VERB` (`src/bash-guard.ts`) + a test |
| 2 | **Per-rule feed allowlist** (`feeds.allow: [rule ids]` in `.blitz/blitz.config.yaml`) | the only way to go from monitor → enforce without eating known false positives (e.g. Sigma "Chmod Targeting Sensitive Directories", negated filters that need missing context) | S | none; read the rule ids off `blitzpi report`'s hit ledger |
| 3 | **`feeds rollback` output after a forced re-download of unchanged content shows identical hashes** | cosmetic, confusing | S | none |
| 4 | **Audit housekeeping on the dev machine** — `blitzpi audit --prune` (28 empty probe files, 56 dead `/tmp` projects) | hygiene; the command exists, it just hasn't been run | S | user action |

## P1 — measure, then enforce (process, little code)
| # | Item | Why | Effort | Blocker / note |
|---|---|---|---|---|
| 5 | **One monitor week, then flip feeds to enforce per feed** (`feeds.secrets`, `feeds.commands`, `feeds.urls`) | the feeds ship in monitor by design; the hit ledger in `blitzpi report` is the false-positive measure | S | needs #2 for the noisy rules; needs a week of real sessions |
| 6 | **OSV package feed behind the opt-in too?** (today it is on by default because it installs nothing) | consistency with "security feeds are opt-in" — an org may still object to outbound OSV queries at install time | S | product decision; one config default |

## P2 — leverage (upgrades several layers at once)
| # | Item | Why | Effort | Blocker / note |
|---|---|---|---|---|
| 7 | **Network policy for the bash sandbox** — egress rules (bwrap `--unshare-net` + allowlisted proxy, Seatbelt network rules) | host network is shared today; this makes the URLhaus feed enforceable at the network layer instead of the command line, and closes exfiltration by any command | L | design: allowlist vs proxy; must not break package installs / `/login` |
| 8 | **Org mirror / governance-endpoint feed distribution** (`feeds.mirror:`) | enterprises pin and serve their own feed bundles; also the path to a signed bundle | M | F4 store exists; needs the governance API side |
| 9 | **Version-aware vulnerability (GHSA/CVE) checks on install** | OSV returns advisories per version; `MAL-*` is version-independent and ships, advisories need the resolved version | M | read the lockfile after install; policy (block? warn?) |
| 10 | **Sigma: parent-process context** — evaluate `ParentImage`/`ParentCommandLine` where we can (we are the parent: bash under the agent) | recovers some of the 16 skipped rules and the negated filters | M | needs a process-tree model of what we actually know |

## P3 — platform
| # | Item | Why | Effort | Blocker / note |
|---|---|---|---|---|
| 11 | **npm publish** `@blitz/pi-coding-agent` | second install channel; verify the `bun patch` rebrand survives a global install | M | none |
| 12 | **Windows bash isolation — AppContainer backend** + guard for the `powershell` tool | Windows today = `pinned` guard via Git Bash (not OS-isolated, and a git dependency) | L | needs a Windows machine; native helper (C++/Rust/.NET) |
| 13 | **Pi install telemetry decision** (`PI_TELEMETRY`) | the launcher already skips Pi's version check; whether the rebranded build sends Pi's install ping is the owner's call | S | owner decision |
| 14 | **Delete historical scaffolding** — `test-governance.ts`, `test-sandbox-runtime.ts`, `verify-governance.sh`, `verify-implementation.js`, `mock-governance-server.js` | superseded by `tests/` + `scripts/` | S | keep `mock-governance-server.ts` if the `custom` provider is used |
| 15 | **In-TUI header hint** — Pi 0.84.3 ignores `setHeader`; the banner carries the hint | goes away on a Pi upgrade | — | Pi upstream |

## P4 — research-grade (needs a model or a corpus we don't have)
| # | Item | Why | Effort | Blocker / note |
|---|---|---|---|---|
| 16 | **Compiled feed bundle built in CI** | only for an *offline* npm malicious-package dictionary (>100k names; OSV bundle 221 MB) | M | unblocked by an org that forbids outbound OSV queries |
| 17 | **Pulled injection phrase corpus** | public corpora (`verazuo/jailbreak_llms`, `deepset/prompt-injections`, L1B3RT4S) are whole prompts, not phrases; licences vary | L | a maintained phrase list, or #18 |
| 18 | **Model-based prompt-injection classifiers** (Prompt Guard 2, ProtectAI DeBERTa) | better than shapes on read content | L | means shipping a model |
| 19 | **ML threat detection beyond the pattern tiers** | | L | |
| 20 | **Rate limiting** in access profiles · **multi-user** profiles/audit · **audit web UI** | | M–L | no current ask |

## External / for the record
- **Command Code Provider API rejects CLI-minted keys** (401 on `/provider/v1/*` even via curl with a key `/alpha/whoami` accepts). Server-side at Command Code; `pi-commandcode-provider` 0.6.0 only falls back on `403 upgrade_required`. Report upstream.
- **Done in 1.1.3/1.1.4** (history): per-call governance enforces via `ctx.abort()`; install-dir doc paths stripped from the prompt; `npmCommand` pinned per workspace; real `/blitz-security`; one enforce/monitor/off vocabulary.
- **Done in 1.2.100** (history): diagnostics (`blitzpi report`/`projects`, inspectable `/blitz-security`), `versions`/`rollback`/`use`, OSV package feed, opt-in feed store with gitleaks / Sigma / URLhaus, content-side injection scan — `docs/plans/ROADMAP.md`.
