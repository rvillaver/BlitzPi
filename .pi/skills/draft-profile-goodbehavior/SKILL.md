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
even when the project's shape looks obvious from its name or from context already in the conversation.

**Ask exactly this. Don't paraphrase it, and don't "improve" it with the vocabulary below.**

> **question:** `What kind of project is this — and how would you know the work is actually right?`
>
> | label | description |
> |---|---|
> | `An app or service` | `I check it by running it` |
> | `Data or analysis` | `I check the numbers against real input` |
> | `Research or writing` | `I check the claims against sources` |
> | `Something people read or watch` | `I check how it lands with them` |

Leave `allowOther` on (the default) so "Other — type an answer" is offered; the free-text answer is a first-class
outcome, not a failure.

**The user's words are the interface; the taxonomy is yours alone.** The labels above map internally to
`development` / `analysis` / `research` / `creative`, and *nothing else in this file appears in the dialog*. Never
show the user "truth-source", "conclusion/dataset", "audience artifact", "verify slot", "evidence slot", or a
profile's filename — those are internal names for internal reasoning. If you catch yourself explaining the taxonomy
to justify the question, you have already lost the user.

Guessing wrong costs a redraft later; asking costs one tool call. If the answer is ambiguous or straddles two
(a data pipeline: built like an app, checked like data), ask **one** follow-up in the same plain register — name the
split in their terms ("built like an app, but checked like data — is that right?"), not by naming two profiles.

In a non-interactive run (no UI to ask), the `question` tool says so instead of guessing: state the assumption you're
proceeding on, out loud. Never silently skip the question and start reading.

## 2. Match, compose, or fall back
The four options in step 1 already *are* the mapping — `An app or service` → `development`, `Data or analysis` →
`analysis`, `Research or writing` → `research`, `Something people read or watch` → `creative`. Don't go looking for
an index to tell you that; read **only the 1-2 closest profile bodies**, never all four.

**Where those files are:** the absolute directory is given to you in the `<goodbehavior-paths shipped-profiles="…">`
block in your system prompt — read it from there. Don't compute a relative path and don't look under the project's
own `.pi/`: these profiles ship with the BlitzPi install and are never copied into a project, so `.pi/goodbehavior/…`
fails with ENOENT. (`blitzpi paths` prints `current=<install root>` as a fallback if that block is ever missing.)
- **Single match** — the answer clearly names one truth-source. Read that profile's body.
- **Composed** — the answer straddles two (the canonical case: build like `development`, verify like `analysis`).
  Read both bodies; the drafted profile will blend them (step 4).
- **Custom fallback — never decline.** Nothing fits any of the four? Ask directly, still in plain register:
  *"What are you actually making here? How would you check it's right? What would convince you it's finished?"* —
  and draft from those answers instead of forcing a mismatched core profile onto it.

## 3. Corroborate with the project
Read the project for real — README, package manifest (package.json/pyproject.toml/Cargo.toml/go.mod/…), directory
layout, existing docs — to ground the *specifics* (stack, workflow, build/verify commands). This confirms the
resolved slots from steps 1-2; it does not override them.

## 4. Draft the profile content
Start from the matched (or primary, if composed) profile's body — it's already the lean, domain-specific layer
("How to check the work is right" / "What to look for when reviewing" / "Where things go") — and reuse its actual
wording where it fits rather than rewriting from scratch. Never copy or touch the shipped `goodbehavior/doctrine.md` —
that's the invariant layer, shared and injected unconditionally regardless of which profile is active.

**Keep the headings as they are.** They're written as plain documentation so that someone who opens this file having
never read the doctrine can still tell what each section is for. Don't rename them into doctrine vocabulary
("Verify level", "Audit lenses", "Evidence slot") — the file is read by humans, not only by you. Tailor:
- frontmatter `name`/`description` — what "the real thing" is here
- `done_gate.build_tools`/`observe_tools` — which tools count as building vs. observing/verifying *for this
  project's actual workflow*, chosen **only** from tools this session actually has. Don't trust a remembered
  list — BlitzPi bundles extension tools (web access, MCP, subagents) on top of Pi's own, so the set varies.
  Typically: `bash`, `edit`, `read`, `write`, `question`, `channel_post`, `web_search`, `fetch_content`, `get_search_content`, `source_check`.
  A name that isn't registered never matches a real call, so the done-gate silently never sees "observed" happen —
  `webfetch` is the classic example of a tool that sounds right and does not exist.
  Prefer `bash` for running things, `read` for checking a local source or output, and `fetch_content`/`web_search`
  for checking a claim against an online source. Leave navigation tools (`find`/`grep`/`ls` where present) out of
  `observe_tools` — they fire nearly every turn, and counting them disarms the gate.
- `done_gate.verify_hint` — one line, in this project's own words, telling a blocked turn what to actually go do
  ("run the CLI against a staged call and watch it block", "open the source and confirm it says that"). This is the
  message the user sees when the gate fires; without it they get a bare list of tool names.
- **"How to check the work is right"** — if composed, replace this section's content with the *verify-slot* profile's method, not the
  build-slot profile's; state in one line which core profile each slot came from ("built ← development, verified ←
  analysis") so a reader isn't confused by a blended file
- **"What to look for when reviewing"** — which dimensions matter for this project's shape
- **"Where things go"** — match the project's own existing structure if it already has one; don't impose
  `docs/audit/` on a project that already organizes this differently

## 5. Write the profile file
Use the Write tool now. Name the file after the project or its real shape, not `development.md` — e.g.
`research.md`, `cli.md` — and write it to `.blitz/goodbehavior/profiles/<name>.md`. A draft that exists only as text
in your response, not as this file, is not done.

## 6. Check the frontmatter against the real tool list
`read` the file you just wrote — the file, not your memory of it — and check every `build_tools`/`observe_tools`
value against the tools **this session actually registered**. Any value that isn't one is dead config: fix it now,
before moving on. This is a step, not advice — a tool name that looks right is exactly the failure it catches, so
read and check rather than assume.

## 7. Wire it in — mandatory, not optional
The file from step 5 does **nothing** until this step: set `goodbehavior.profile: <new-name>` in
`.blitz/blitz.config.yaml` (create the file if it doesn't exist). Without this edit the project silently keeps
running on `development` forever, and step 5's file sits there unused. Do this in the same turn as step 5, not as a
follow-up you might get to later.

## 8. Record why
Write a `project-profile` memory (`.blitz/goodbehavior/memory/project-profile.md`, indexed in `MEMORY.md`) — one
line per slot naming its source: matched profile, composed (name each slot's source), or custom (elicited directly).
This is a durability record for whoever reads the project later — `/verify-goodbehavior` and
`/gate-build-goodbehavior` don't depend on it; they already read the drafted profile's own content directly, which
is correct regardless of how it was resolved.

## 9. Confirm
Steps 5-8 are already written to disk. Now show the user what you wrote and why, and ask them to confirm or correct
it — this is doctrine that governs every future turn, not a file to silently leave in place unreviewed. If they ask
for changes, edit the file that's already there, not a new draft in chat. **No restart needed:** the active profile
is re-resolved at the start of every turn, so the profile you just wired in governs the user's next message. Don't
tell them to restart.

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
