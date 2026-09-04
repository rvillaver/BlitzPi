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
1. **Necessary** — does it need to exist at all?
2. **Already here** — this project already does it, or something close enough to extend?
3. **Already provided** — the language/tool/format/convention you're working in supplies it natively?
4. **Smallest unit** — the medium's smallest form says/does it (one line, one sentence, one assertion, one beat)?
5. **Minimum bespoke** — only then: the least new material that closes the gap, nothing decorative.

## Keep the working set current
**Writing "done" is only half an edit.** The moment you mark anything settled — a phase, an item, a test case, a
finding — moving it out of the working document is part of *that same change*, never a later chore:
1. **Settled** (done, verified, confirmed) — append it, whole, to that corpus's `archive/` and leave **one digest
   line** behind pointing there. A closed phase is one line, not a full table every future reader scrolls past.
2. **Superseded** (replaced by something specific) — **collapse it into its successor**, which gains one line of
   provenance. Don't keep both halves; the successor is where a reader will look.
3. **Unsure whether it's really settled?** — **it stays.** Never evict what you cannot show is finished.

If you catch yourself appending `DONE` to a line and moving on, stop: the document is now longer and less useful
than before you touched it. Marking done and archiving are one action.

**What "settled" means depends on the corpus, and getting this backwards destroys the thing you're keeping.** A plan
phase is settled when its work is finished. A **learning is not** — a memory about a bug you already fixed stays
live, because the trap it describes can recur and the reasoning still holds. A learning becomes history only when it
is no longer *true*: falsified, or superseded by a better account of the same thing. **Archive a plan on "done";
archive a learning only on "no longer true."**

Archived material stays readable and greppable — it loses its claim on working context, not its existence. **Never
delete to tidy up**, and never groom a document you weren't already working in.

## Gate rules
No unverified claims · evidence before "done" · learnings recorded per phase · a `⚠` never advances a phase ·
a working document that is mostly closed history is a finding, not a filing system.

## The governed shell (facts, so you don't rediscover them)
- Bash runs in a sandbox confined to this workspace; `/tmp` is scratch space you may use and read back.
- Background processes end when the command returns: start a server and probe it **in the same command**
  (`bun index.ts & sleep 1; curl -s localhost:3000/health; kill $!`).
- `bun` (the runtime BlitzPi ships) is on PATH; network is available for package installs.
- A blocked action shows `[BLOCKED]`/`[THREAT DETECTED]` — report it as a blocker, don't work around it with tricks.
