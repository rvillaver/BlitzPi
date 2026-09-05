---
name: development
description: Software development — the real thing is a running program, exercised the way its user would use it.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash, powershell]
  verify_hint: run the program and exercise the real flow the way its user would
---
# GoodBehavior — development profile

## How to check the work is right
Exercise the running program like its user: drive the real flow (UI + backend effect, CLI + output, API + state),
capture the evidence beside the reference. A green test suite is necessary, not sufficient. TUI-only behaviour needs a
real terminal, not print mode.

## What to look for when reviewing
Coverage vs the reference · completeness/wiring (reachable end to end?) · security · flow/UX · reuse (hand-rolled
what a library provides?). Run them as separate passes; where two of them disagree, that disagreement is itself a finding.

## Where things go (defaults — keep the project's own structure if it already has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plans: one file per initiative, `docs/plans/<INITIATIVE>.md`; `docs/plans/ROADMAP.md` is a thin index of the
  **active** ones only; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
- archive (settled material, per corpus): `docs/plans/archive/`, `docs/audit/archive/` — named by completion
  date plus the shipped version if there is one, e.g. `2026-08-30-feeds-1.2.100.md`
