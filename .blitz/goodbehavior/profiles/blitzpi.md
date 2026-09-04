---
name: blitzpi
description: BlitzPi — a governance extension for the Pi coding-agent CLI. The real thing is the CLI running end-to-end with access profiles, LLM-call governance, and file-I/O sandboxing enforced — proven live, not just described.
done_gate:
  build_tools: [edit, write, bash]
  observe_tools: [bash]
---
# GoodBehavior — blitzpi profile

## Verify level (blitzpi)
Exercise the real CLI — dev-linked (`bun link`, then `blitzpi`) or the installed one — never a description of it.
Governance and sandboxing are enforced by the runtime/OS, not by prompt text: prove a layer works by triggering the
actual disallowed action and watching it get blocked (`[BLOCKED] …` / `[THREAT DETECTED]`), and a permitted one
succeed, in a real or scripted session. TUI-only surfaces (header, footer, banners, prompts, themes) need a real
terminal — drive them through a pty (`tests/tools/pty-smoke.py` is the working pattern here) — print/headless mode
never renders them, so it cannot verify them. Headless probes (`blitzpi -p "<prompt>" </dev/null`) are sufficient for
governance/tool-gating logic that doesn't depend on TUI rendering. A green Jest suite is necessary, never sufficient
— it proves the parsing/decision logic, not that the real CLI enforces it end to end.

## Audit lenses (blitzpi)
Coverage vs the spec/design · completeness/wiring (does a layer actually gate a real tool call, or is it dead
config nobody reads?) · security (bypass via approved grants, symlinks, variable-built paths, or a different
backend) · cross-platform (bwrap/Linux vs Seatbelt/macOS vs the non-isolated `pinned` fallback — a layer verified on
one backend is *unverified* on the others, not "probably fine") · reuse (hand-rolled vs. something Pi/Bun/an
installed dependency already provides — BlitzPi is an extension, not a fork; the less it reimplements of Pi's own
tool/session/UI machinery, the less there is to keep in sync with upstream). Run these as separate passes; a
contradiction between lenses (e.g. "built" on one backend, "unreachable" on another) is itself a P0/P1 finding.

## Sandbox specifics (blitzpi)
- Bash runs through one of three pluggable backends — `bwrap` (Linux), `sandbox-exec`/Seatbelt (macOS), or a
  non-isolated `pinned` fallback elsewhere (`src/sandbox-backends.ts`). Which one is active changes what "confined"
  actually means — check `selectBackend()` before assuming isolation, don't assume bwrap-level guarantees on every
  platform.
- The bwrap backend read-only binds real host system directories (`/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc`,
  `/opt`, `/run`) rather than building a minimal rootfs — it is not an airtight container. Notably `/usr/local` and
  `/opt/homebrew` are **not** bound, so host tools installed under either are invisible inside it even though the
  host has them.
- No backend sets `PATH` explicitly anywhere — it's inherited from the host process untouched. A bind-mount alone
  does not make a binary resolve by bare name unless its directory happens to already be on `PATH`.
- Background processes end when the command returns: start a server and probe it **in the same command**
  (`bun index.ts & sleep 1; curl -s localhost:3000/health; kill $!`).
- `bun` (the runtime BlitzPi ships and runs on) is always reachable inside the sandbox via a dedicated bind
  (`RUNTIME_DIR`); nothing else is guaranteed present unless the host happens to provide it under one of the bound
  system directories above.
- A blocked action shows `[BLOCKED]`/`[THREAT DETECTED]` in real output — report it as a blocker, never work around
  it with a trick that defeats the point of the layer being tested.

## Where things live
- learnings: `.blitz/goodbehavior/memory/` (index `MEMORY.md`, one fact per file) — this is the doctrine's own
  project memory, separate from anything under `.claude/` (that path is a private, gitignored workshop for one
  particular contributor's own tooling, not part of this project's tracked structure; don't assume it exists).
- audit register / roadmap / backlog: **check before writing.** If this checkout has a private, untracked narrative
  location already in use (a contributor's own workshop directory, findable by asking or by checking `.gitignore`
  for an ignored `docs`-shaped path), that's where this repo's maintainers currently keep audit/plan/backlog
  commentary — the public tree intentionally carries only the product (source, tests, `README.md`, `CHANGELOG.md`,
  `docs/ARCHITECTURE.md`, `docs/SECURITY-ZONES.md`, the installer, `patches/`). If no such location exists in this
  checkout, ask before inventing a new `docs/audit/`/`docs/plans/` in the tracked tree rather than assuming a
  standard open-source layout applies here.
- archive (settled plans/audit batches): an `archive/` subdirectory of whichever narrative location is in use, named
  by completion date plus the shipped version where there is one (`2026-08-30-feeds-1.2.100.md`). BlitzPi's own
  shipped artifacts (`.pi/goodbehavior/`, `.pi/skills/`) are never archived — they are overwrite-to-latest by design,
  so "latest is present" already holds there; only the narrative accumulates.
