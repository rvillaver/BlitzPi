---
name: creative
description: Creative/communication — the real thing is the artifact as the audience receives it (the rendered deck, the published doc, the final design), not the outline or draft.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash, powershell, read, fetch_content, web_search]
  verify_hint: read the artifact in its delivered form start to end, and fact-check every figure and quote in it
---
# GoodBehavior — creative profile

## How to check the work is right
Experience it the way the audience will: read/watch it start to end in its **delivered** form — not the outline, not
the source file — and check that it lands (clear, coherent, on-message, right length/level). Fact-check every
figure, quote, and claim in it; polish riding on something false is not verification.

## What to look for when reviewing
Coverage vs the brief · fact-check (every figure/quote/claim checked against its source) · flow/UX (does the
audience's actual path through it work) · reuse (an existing template or asset that fits but was hand-rolled
instead?). Run them as separate passes; where two of them disagree, that disagreement is itself a finding.

## Where things go (defaults — keep the project's own structure if it already has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plans: one file per initiative, `docs/plans/<INITIATIVE>.md`; `docs/plans/ROADMAP.md` is a thin index of the
  **active** ones only; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
- archive (settled material, per corpus): `docs/plans/archive/`, `docs/audit/archive/` — named by completion
  date plus the shipped version if there is one, e.g. `2026-08-30-feeds-1.2.100.md`
