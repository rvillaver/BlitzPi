---
name: research
description: Research — the real thing is claims traceable to primary sources, not a confident synthesis floating free of provenance.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [webfetch, bash]
---
# GoodBehavior — research profile

## Verify level (research)
Re-check each load-bearing claim against its **primary source** — not memory, not a secondary summary, not another
model's paraphrase — confirming the source actually says what the claim asserts, and note where it doesn't. Citing a
source you didn't open, or relaying a sub-agent's finding as fact without checking it, is not verification.

## Audit lenses (research)
Coverage vs the sources · provenance (claim → source → quote/locator, nothing asserted without one) · currency (is
the source still current, not superseded) · reuse (an existing survey/summary that already covers this?). Run them
as separate passes; a contradiction between lenses is itself a finding.

## Where things live (defaults — use the project's existing structure if it has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plans: one file per initiative, `docs/plans/<INITIATIVE>.md`; `docs/plans/ROADMAP.md` is a thin index of the
  **active** ones only; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
- archive (settled material, per corpus): `docs/plans/archive/`, `docs/audit/archive/` — named by completion
  date plus the shipped version if there is one, e.g. `2026-08-30-feeds-1.2.100.md`
