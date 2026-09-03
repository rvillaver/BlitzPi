# Project profiles — the on-demand layer

A **profile** fills two slots that make "done" concrete for a *kind* of work: **verify** (what exercising it like a
consumer means) and **evidence** (what proof looks like). The invariant doctrine (`.pi/goodbehavior/doctrine.md`)
is the same regardless of profile — only these slots change by project type, because only one thing changes: **what
you check the work against to know it's really done — its truth source.**

Drafting a profile (`/draft-profile-goodbehavior`) reads *this index* up front (cheap), then reads **only the
closest profile body** on demand — never all four. `INDEX.md` itself is never copied into a project;
`adoptGoodBehavior()` copies only the one selected core profile.

## The four core profiles

| Profile | Truth source | Use when the output is checked against… |
|---|---|---|
| [development](development.md) | code execution / runtime | **running software** — a CLI, service, library, extension, pipeline's build |
| [analysis](analysis.md) | data | a **correct conclusion or dataset** — reports, models, pipelines' output, evals |
| [research](research.md) | external sources / prior art | **claims true to their sources** — literature, market/competitive, investigation, compliance |
| [creative](creative.md) | a human audience | an **artifact that lands** — a deck, long-form writing/docs, a design, marketing |

## Composable slots (not yet wired into the adoption flow)

A profile is not meant to be a rigid single pick — a project can take different slots from different profiles. The
canonical case: a **data pipeline** is *built* like `development` (you write code) but *verified* like `analysis`
(correct output on real input). Today's `draft-profile-goodbehavior` resolves to exactly one profile per project;
composing slots across profiles, and eliciting a custom fallback when none of the four fit, is tracked separately
(`.claude/docs/plans/GOODBEHAVIOR-PROFILES.md`, Phase 3) — not yet built. Don't assume composition works until that
phase lands.

## The custom fallback (planned, not built)

If a project matches none of the four, the intent is for adoption to never decline — it would elicit "what's the
real thing, how would you check it's right, what would count as proof?" directly and write those as a custom
profile, the way `.blitz/goodbehavior/profiles/blitzpi.md` was hand-drafted for this repo. Today that only happens
by an agent doing it manually, not as a built adoption step.
