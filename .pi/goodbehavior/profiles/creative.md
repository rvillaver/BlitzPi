---
name: creative
description: Creative/communication — the real thing is the artifact as the audience receives it (the rendered deck, the published doc, the final design), not the outline or draft.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash, webfetch]
---
# GoodBehavior — creative profile

## Verify level (creative)
Experience it the way the audience will: read/watch it start to end in its **delivered** form — not the outline, not
the source file — and check that it lands (clear, coherent, on-message, right length/level). Fact-check every
figure, quote, and claim in it; polish riding on something false is not verification.

## Audit lenses (creative)
Coverage vs the brief · fact-check (every figure/quote/claim checked against its source) · flow/UX (does the
audience's actual path through it work) · reuse (an existing template or asset that fits but was hand-rolled
instead?). Run them as separate passes; a contradiction between lenses is itself a finding.

## Where things live (defaults — use the project's existing structure if it has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plans: one file per initiative, `docs/plans/<INITIATIVE>.md`; `docs/plans/ROADMAP.md` is a thin index of the
  **active** ones only; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
- archive (settled material, per corpus): `docs/plans/archive/`, `docs/audit/archive/` — named by completion
  date plus the shipped version if there is one, e.g. `2026-08-30-feeds-1.2.100.md`
