---
name: goodbehavior-profile-doctrine
description: GoodBehavior's loop/done-rule lives in ONE data file (the active profile) and is injected into the system prompt only for projects that adopted it; skills reference it instead of restating it. Records why the .claude/ tree, the manifest, the Python update flow and the TS-string profile were deleted (2026-08-29).
metadata:
  type: project
---

**Fact:** The doctrine (loop, done rule, honesty, standing-proceed, lenses, where files live) is
`.pi/goodbehavior/profiles/<name>.md` in the install, copied to `<project>/.blitz/goodbehavior/profiles/` on adopt,
selected by `goodbehavior.profile` in `.blitz/blitz.config.yaml` (default `development`). `src/goodbehavior/index.ts`
appends the active profile to the system prompt in `before_agent_start` — **only when the project adopted GoodBehavior**.
Skills say "per the profile" and chain to each other (Before/After lines); they don't restate the doctrine.

**Why:** Before this, the same doctrine was hardcoded in three disagreeing places (CLAUDE.md prose, a TS string in
`blitz-config.ts`, a TS template in `goodbehavior/config.ts` writing a profile nothing read), and nothing was injected —
an adopted project got 7 skill files and zero idea of the loop (the Mac `app-stack` interrogation). A stale, gitignored
but tracked `.claude/goodbehavior/` tree and an `update-goodbehavior` skill describing a Python/Claude-Code flow
(`scripts/update.py`, `settings.json`, `done-gate.py`) that never existed in BlitzPi misled every reader.

**Trap:** an earlier decision (launcher-facts addendum 11) removed system-prompt injection because the *security*
prompt made the model refuse safe in-workspace work. Don't reintroduce security language into the prompt — the runtime
gate enforces; the profile is about *how to work*, plus one anchoring line (this workspace is the project).

**How to apply:** change doctrine in the profile file, never in TS or skills. `/adopt-goodbehavior` re-copies shipped
skills+profile, keeping files the project edited (sha256 manifest in `.blitz/goodbehavior/manifest.json`).
`/unadopt-goodbehavior` removes them (memory kept unless asked). Repo memory lives in `.blitz/goodbehavior/memory/`.

**Verified end to end (2026-08-29, v1.1.0):** installed via the public `curl | sh` into a fresh HOME (real `~/.pi` login
linked in), new workspace, the user's design-doc prompt as `blitzpi -p "/skill:audit-goodbehavior <doc>"` then
`/skill:roadmap-goodbehavior`: turn 1 answered "0% built; reference = …" + wrote `docs/audit/00-index.md` (27 s, no
questions); turn 2 wrote `DESIGN.md`, `ROADMAP.md`, `PRODUCTION-BACKLOG.md` (1m34). Audit trail: 0 reads outside the
workspace across both turns. **Method:** `/skill:<name>` expansion works in print mode; prove injection with a
`before_agent_start` dump extension (`-e dump.ts`) reading `event.systemPrompt`, not by asking the model (a two-part
question got "NONE" while the section was present); prove non-roaming from `~/.blitz/audit/*.jsonl` zones.
