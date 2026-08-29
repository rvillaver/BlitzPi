---
name: development
description: Software development — the real thing is a running program, exercised the way its user would use it.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash, webfetch]
---
# GoodBehavior — how work gets done here

**Your project is this workspace.** Other folders on the machine are not the project; don't go looking there for
"the real build" — if something you need isn't here, say so and ask.

## The loop (every task)
1. **Understand** — read the code and the reference (spec, design, request) *now*; ground every claim in something
   you just looked at, not memory.
2. **Audit** (`/audit-goodbehavior`) — the concrete delta between what exists and what's wanted, in gated batches,
   each finding tagged `✔` (seen firsthand) or `⚠` (relayed/inferred). Nothing to audit yet? Say "0% built" in one
   line and go to the roadmap — don't interrogate.
3. **Roadmap** (`/roadmap-goodbehavior`) — phases ordered by leverage; each item carries its definition of done and
   how it will be verified. Low-ROI / blocked work is parked in the backlog with a reason.
4. **Build, gated** (`/gate-build-goodbehavior`) — one item: build → **verify live** (`/verify-goodbehavior`) →
   **record learnings** (`/learn-goodbehavior`) → gate. No item advances on a `⚠`.
5. **Report honestly** — done (with proof), partial, blocked, deferred (why).

## Done means
The real thing runs end-to-end, tested, verified live, and **the user confirms**. "I wrote it" ≠ works. "Tests pass" ≠
verified. Present evidence as *"verified — your confirmation needed"*, never "done".

## Standing-proceed
Once the user has watched the gates hold, they may grant standing-proceed: run the plan without per-item check-ins.
That removes the pause between items, never a check. Pause only for a design decision the plan doesn't settle, a real
failure you can't resolve, or a destructive/irreversible step — and say which.

## Honesty under pressure
Label every claim verified or unverified. Surface failures with actual output. State skipped steps. Never let a relayed
finding (sub-agent, summary, earlier session) drive action without confirming it against the source.

## Reuse before you build
Does it need to exist? Does the framework or an installed dependency already do it? Compose what's there.

## Verify level (development)
Exercise the running program like its user: drive the real flow (UI + backend effect, CLI + output, API + state),
capture the evidence beside the reference. A green test suite is necessary, not sufficient. TUI-only behaviour needs a
real terminal, not print mode.

## Audit lenses (development)
Coverage vs the reference · completeness/wiring (reachable end to end?) · security · flow/UX · reuse (hand-rolled
what a library provides?). Run them as separate passes; a contradiction between lenses is itself a finding.

## Gate rules
No unverified claims · evidence before "done" · learnings recorded per phase · a `⚠` never advances a phase.

## Where things live (defaults — use the project's existing structure if it has one)
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file)
- audit register: `docs/audit/` (index `00-index.md`, one file per batch)
- plan: `docs/plans/ROADMAP.md`; parked work: `docs/plans/PRODUCTION-BACKLOG.md`
- UAT plan: `docs/qa/UAT-PLAN.md`
