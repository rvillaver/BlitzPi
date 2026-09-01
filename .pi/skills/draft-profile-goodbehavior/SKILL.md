---
name: draft-profile-goodbehavior
description: Draft a project-specific GoodBehavior profile — tailor the doctrine (what "done" means, how to verify, where files live) to what this project actually is, instead of the generic shipped default. Use right after adopting GoodBehavior into a project that doesn't have a tailored profile yet.
---

# Draft a project-specific profile

`.blitz/goodbehavior/profiles/development.md` is a generic template, not written for this project. Replace it with
one that is.

1. **Read the project for real** — README, package manifest (package.json/pyproject.toml/Cargo.toml/go.mod/…),
   directory layout, any existing docs. Determine what the real thing here actually is: a running app, a dataset,
   a research/content track, a CLI, a library — don't guess from the folder name.
2. **Copy `development.md` as the starting point.** Keep unchanged: the loop, "Done means", "Standing-proceed",
   "Honesty under pressure", "Reuse before you build", "Gate rules", "The governed shell" — these are universal,
   not project-specific.
3. **Tailor only what's actually project-specific:**
   - frontmatter `name`/`description` — what "the real thing" is here
   - `done_gate.build_tools`/`observe_tools` — which tools count as building vs. observing/verifying *for this
     project's actual workflow* (e.g. a slide deck's build tool isn't `edit`+`bash`, it's the render command)
   - "Verify level" — how a human actually exercises the real thing here (driven UI? rendered output read and
     fact-checked? a dataset validated against real input?)
   - "Audit lenses" — which dimensions matter for this project's shape
   - "Where things live" — match the project's own existing structure if it already has one; don't impose
     `docs/audit/` on a project that already organizes this differently
4. **Name the file after the project or its real shape**, not `development.md` — e.g. `research.md`, `cli.md`.
5. **Wire it in**: set `goodbehavior.profile: <new-name>` in `.blitz/blitz.config.yaml` (create the file if it
   doesn't exist) — the new profile is never loaded until this points at it.
6. **Show the user what you drafted and why**, and ask them to confirm or correct it before treating it as settled
   — this is doctrine that governs every future turn, not a file to silently replace.
7. Tell them to restart BlitzPi here — profiles load at extension setup, same as skills.
