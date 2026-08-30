# Blitz CLI: Operating principles

## The one rule: what "done" means

**Done = the CLI runs end-to-end with governance and constraints working, tested, and verified — the user confirms it.**

For this project:
- **The real thing:** A CLI that enforces access profiles on tool calls, gates LLM calls through a governance API, and confines all file I/O to the run directory (100% sandboxed).
- **Verify:** Both automated tests (constraint violations are caught) and live behavioral tests (run the CLI against real/staged LLM+tool calls, observe enforcement).
- **Evidence:** Test suite passes + capability demo showing blocked operations + safe operations succeed.

Until the real CLI demonstrates all three (tests + live + demo), status is **"not done yet."**

## The loop (every task runs this)

1. **Understand** — read the code & spec, not memory. Ground claims in something just looked at.
2. **Audit** — find gaps between what exists and what's wanted (`/audit-goodbehavior`).
3. **Plan** — roadmap the gaps in order, park low-value work (`/roadmap-goodbehavior`).
4. **Build, gated** — one phase: build → **verify live** (`/verify-goodbehavior`) → record learning (`/learn-goodbehavior`) → gate before next phase (`/gate-build-goodbehavior`). Loop until concrete evidence; don't drift forward.
5. **Report honestly** — say what's done (with proof), what's partial, what's blocked, why you deferred.

## Standing-proceed

Once the user has watched the gates hold (verify → learn → gate), they can grant **standing-proceed**: run the loop continuously through the plan unattended, without per-item check-ins. This removes the *pause between items*, not the checks — every item still verifies, records, gates exactly as before. **Only pause for design decisions, real failures, or destructive/irreversible steps.**

## Record learnings

Write non-obvious traps, corrections, hard-won facts about how this project builds/runs/behaves to `.blitz/goodbehavior/memory/` (index `MEMORY.md`) so the next session doesn't relearn them.

The loop above is the *development profile* — its single source of truth is `.pi/goodbehavior/profiles/development.md` (what adopted projects receive and what BlitzPi injects into the agent). Change doctrine there, not here or in code.

## Reuse before you build

Before writing code: does it need to exist? Does the framework/an installed dependency already do it? Prefer composing what's there over hand-rolling. A thin wrapper around something existing is usually the lazy path, not the lean one.

## Honesty under pressure

Label every claim **verified or unverified**. "I wrote it" ≠ "the constraint works." "Tests pass" ≠ "the CLI runs safely." Surface failures with actual output. State skipped steps.

**Never let an unverified claim drive action.** If a finding is relayed (from a sub-agent, earlier summary, external source), verify it against the real source before building on it.

## Stack & conventions

- **Language:** TypeScript
- **Package manager / build:** Bun; **no build step** — Pi loads `src/index.ts` natively
- **Local dev loop:** `bun link` once, then `blitzpi` (= Pi 0.84.3 + `-e <repo>` + bundled packages); `blitzpi -p "…" </dev/null` for headless probes
- **Deploy / release:** npm package `@blitz/pi-coding-agent` (pending) + GitHub releases; Pi is rebranded via a committed `bun patch` (`patches/`). A push is not released until it is tagged **and** `gh release create vX.Y.Z` has run (`blitzpi update` reads `releases/latest`). **Versioning:** we are on **1.2.1xx** — 1.2.100 shipped 2026-08-30; each later release is the next patch number (1.2.101, …) (three-digit patch; leading zeros are invalid semver, so the series starts at 100). The minor stays at 2; we ship improvements, not major features. **Pushes are not releases**: push to `master` freely, cut a release only when asked or when there is a user-visible improvement worth a `blitzpi update`; until then CHANGELOG notes go under an `## Unreleased` heading.
- **Credentials:** Pi `/login` only (`~/.pi/agent/auth.json`); never API keys in env
- **Verify target:** Local Pi instance running with Blitz extension + live governance API
- **CI / test framework:** Jest + GitHub Actions

**Architecture:** Blitz is a governance extension for Pi, the minimal agent harness. Pi provides tool execution, LLM routing, and session management; Blitz adds access profiles, governance API gating, and file I/O sandboxing via Pi's extension system.

**Foundation:** https://github.com/earendil-works/pi (`@earendil-works/pi-coding-agent` **0.84.3**, pinned in `package.json`) — See `docs/research/pi-integration.md` for integration points (note its correction header: there is no `llm_call` hook; LLM gating needs a provider wrapper).
