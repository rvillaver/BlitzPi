---
name: draft-profile-goodbehavior
description: Draft a project-specific GoodBehavior profile — ask what this project actually is, match or compose it against the four core profiles (or fall back to a custom one), then tailor and confirm it. Use right after adopting GoodBehavior into a project that doesn't have a tailored profile yet.
---

# Draft a project-specific profile

`.blitz/goodbehavior/profiles/development.md` is the generic shipped default, not written for this project. Ask
first, match against the four core profiles, then replace it with one that actually fits. Each numbered step below
is a **separate required action** — do not collapse several into one step and silently drop the rest; a drafted
profile that never gets wired into `.blitz/blitz.config.yaml` accomplishes nothing.

## 1. Ask before reading files
**Hard gate: call the `question` tool before any `read`/`bash`/`glob`/`grep` call in this skill, no exceptions —**
even when the project's shape looks obvious from its name or from context already in the conversation. Ground the
question in `.pi/goodbehavior/profiles/INDEX.md`'s four truth-sources: "What kind of work is this project, primarily
— how do you know it's actually right?" Options: **running software** (checked by exercising it), **a
conclusion/dataset** (checked against real data), **claims** (checked against primary sources), **an artifact for an
audience** (checked by experiencing it as they would) — allow "Other" for anything that doesn't fit. Guessing wrong
costs a redraft later; asking costs one tool call. If the answer is ambiguous or straddles two truth-sources (a data
pipeline: built like software, checked like data), ask one follow-up naming the split rather than guessing which one
wins. In a non-interactive run (no UI to ask), say so explicitly and state the assumption you're proceeding on —
never silently skip the question and start reading.

## 2. Match, compose, or fall back
Read **only `.pi/goodbehavior/profiles/INDEX.md`** (cheap), then **only the 1-2 closest profile bodies** — never all
four:
- **Single match** — the answer clearly names one truth-source. Read that profile's body.
- **Composed** — the answer straddles two (the canonical case: build like `development`, verify like `analysis`).
  Read both bodies; the drafted profile will blend them (step 4).
- **Custom fallback — never decline.** Nothing fits any of the four? Ask directly: "what's the real thing here, how
  would you check it's right, what would count as proof?" and draft from the answers instead of forcing a
  mismatched core profile onto it.

## 3. Corroborate with the project
Read the project for real — README, package manifest (package.json/pyproject.toml/Cargo.toml/go.mod/…), directory
layout, existing docs — to ground the *specifics* (stack, workflow, build/verify commands). This confirms the
resolved slots from steps 1-2; it does not override them.

## 4. Draft the profile content
Start from the matched (or primary, if composed) profile's body — it's already the lean, domain-specific layer
(Verify level / Audit lenses / Where things live) — and reuse its actual wording where it fits rather than
rewriting from scratch. Never copy or touch `.pi/goodbehavior/doctrine.md` — that's the invariant layer, shared and
injected unconditionally regardless of which profile is active. Tailor:
- frontmatter `name`/`description` — what "the real thing" is here
- `done_gate.build_tools`/`observe_tools` — which tools count as building vs. observing/verifying *for this
  project's actual workflow*. Use real registered tool names only (`bash`, `read`, `write`, `edit`, `question`, and
  whatever else this session's tools actually show as `toolName` in a tool call) — not a plausible-sounding name
  like `fetch_content` or `source_check` that isn't a real tool. An invented name never matches a real call, so the
  done-gate silently never sees "observed" happen.
- "Verify level" — if composed, replace this section's content with the *verify-slot* profile's method, not the
  build-slot profile's; state in one line which core profile each slot came from ("built ← development, verified ←
  analysis") so a reader isn't confused by a blended file
- "Audit lenses" — which dimensions matter for this project's shape
- "Where things live" — match the project's own existing structure if it already has one; don't impose
  `docs/audit/` on a project that already organizes this differently

## 5. Write the profile file
Use the Write tool now. Name the file after the project or its real shape, not `development.md` — e.g.
`research.md`, `cli.md` — and write it to `.blitz/goodbehavior/profiles/<name>.md`. A draft that exists only as text
in your response, not as this file, is not done.

## 6. Wire it in — mandatory, not optional
The file from step 5 does **nothing** until this step: set `goodbehavior.profile: <new-name>` in
`.blitz/blitz.config.yaml` (create the file if it doesn't exist). Without this edit the project silently keeps
running on `development` forever, and step 5's file sits there unused. Do this in the same turn as step 5, not as a
follow-up you might get to later.

## 7. Record why
Write a `project-profile` memory (`.blitz/goodbehavior/memory/project-profile.md`, indexed in `MEMORY.md`) — one
line per slot naming its source: matched profile, composed (name each slot's source), or custom (elicited directly).
This is a durability record for whoever reads the project later — `/verify-goodbehavior` and
`/gate-build-goodbehavior` don't depend on it; they already read the drafted profile's own content directly, which
is correct regardless of how it was resolved.

## 8. Confirm and restart
Steps 5-7 are already written to disk. Now show the user what you wrote and why, and ask them to confirm or correct
it — this is doctrine that governs every future turn, not a file to silently leave in place unreviewed. If they ask
for changes, edit the file that's already there, not a new draft in chat. Then tell them to restart BlitzPi here —
profiles load at extension setup, same as skills.

## Definition of done
All four, not some: (1) `.blitz/goodbehavior/profiles/<name>.md` exists with tailored content: (2)
`.blitz/blitz.config.yaml`'s `goodbehavior.profile` points at it, not still `development`; (3)
`.blitz/goodbehavior/memory/project-profile.md` exists and is indexed; (4) the user has seen it and confirmed or
corrected it. Reporting "drafted" when only (1) is true is a false completion claim.

## Anti-patterns (these are NOT done)
- Reading project files before calling the `question` tool, even when the answer seems obvious.
- Presenting the drafted profile as a code block in your response and stopping, without writing it to
  `.blitz/goodbehavior/profiles/<name>.md`.
- Writing the profile file but leaving `.blitz/blitz.config.yaml` unchanged — the single most likely way to do 3 of
  4 done-conditions and skip the one that actually activates anything.
