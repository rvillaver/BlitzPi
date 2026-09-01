---
name: learn-goodbehavior
description: Capture a durable learning — a non-obvious trap, correction, or hard-won fact — so it isn't relearned. Use right after hitting or being corrected on something the next session would otherwise rediscover.
---

**Loop position:** called per item by `/gate-build-goodbehavior`, or whenever something non-obvious was learned.

Write a durable learning to project memory — `.blitz/goodbehavior/memory/` (index `MEMORY.md`), unless the project
already keeps learnings elsewhere. One fact per file; check for an existing file on the same topic and
**update it rather than duplicate**.

## What's worth recording
- **feedback** — a correction or confirmed-good approach from the user. Include the *why*.
- **gotcha** — a non-obvious trap (build/deploy quirk, stale-cache, an API that lies, a config that's bundled not
  read-at-runtime, access that's seeded-not-derived). Include how to detect + the fix.
- **project** — ongoing goals/decisions/constraints not derivable from the code or git history.
- **reference** — a pointer to an external resource (URL, dashboard, ticket).

Don't record what the repo already states (code structure, past fixes, git history, AGENTS.md). If asked to "remember"
something obvious, ask what was *non-obvious* about it and record that.

## Format (one file)
```
---
name: <kebab-slug>
description: <one line — used to decide relevance on recall>
metadata: { type: feedback | gotcha | project | reference }
---
<the fact. For feedback/gotcha, add **Why:** and **How to detect / apply:**. Link related learnings with [[their-name]].>
```
Then add a one-line pointer to the memory index (`.blitz/goodbehavior/memory/MEMORY.md`): `- [Title](file.md) — hook`.

## Recall
At the start of real work, skim the index. A recorded learning that names a file/flag/endpoint reflects what was true
when written — **verify it still holds** before relying on it.
