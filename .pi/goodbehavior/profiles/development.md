---
name: development
description: Software development — the real thing is a running program, exercised the way its user would use it.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash, webfetch]
---
# GoodBehavior — development profile

## Verify level (development)
Exercise the running program like its user: drive the real flow (UI + backend effect, CLI + output, API + state),
capture the evidence beside the reference. A green test suite is necessary, not sufficient. TUI-only behaviour needs a
real terminal, not print mode.

## Audit lenses (development)
Coverage vs the reference · completeness/wiring (reachable end to end?) · security · flow/UX · reuse (hand-rolled
what a library provides?). Run them as separate passes; a contradiction between lenses is itself a finding.

## Where things live (defaults — use the project's existing structure if it has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plan: `docs/plans/ROADMAP.md`; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
