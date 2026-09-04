---
name: analysis
description: Data analysis — the real thing is a conclusion or dataset checked against real (or representative) input, not a toy sample.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash]
---
# GoodBehavior — analysis profile

## Verify level (analysis)
Re-run on real (or representative) input and validate correctness, not just completion: schema/shape, row/record
counts, spot-checks against a known-good, edge and null/empty cases, and whether the conclusion actually follows
from the numbers. "The script exited 0" is not verification, and neither is running on sample/mock data and calling
it done.

## Audit lenses (analysis)
Coverage vs the real input · correctness (does the conclusion actually follow from the numbers, not just "the
pipeline ran") · reconciliation (counts/diffs checked against a known-good) · reuse (hand-rolled what a library or
an existing pipeline already provides?). Run them as separate passes; a contradiction between lenses is itself a
finding.

## Where things live (defaults — use the project's existing structure if it has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plans: one file per initiative, `docs/plans/<INITIATIVE>.md`; `docs/plans/ROADMAP.md` is a thin index of the
  **active** ones only; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
- archive (settled material, per corpus): `docs/plans/archive/`, `docs/audit/archive/` — named by completion
  date plus the shipped version if there is one, e.g. `2026-08-30-feeds-1.2.100.md`
