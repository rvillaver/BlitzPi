# Project Memory — Blitz + GoodBehavior

Durable learnings from building the security governance layer for Pi.

## Phase 6: CLI Integration

- [R6.1 Adoption Implementation](r6-1-adoption-implementation.md) — `blitz init --goodbehavior` creates destination project structure with both Blitz security + GoodBehavior framework. Status: ✔ Verified.

- [R6.2 Skill Runner & Commands](r6-2-skill-runner-and-commands.md) — SkillRunner abstraction + `blitz roadmap/gate` commands with governance loop enforcement (audit → roadmap → gate). Status: ✔ Verified.

## Build Patterns & Gotchas

- [Pi hook & bundle traps](pi-hook-and-bundle-traps.md) — `before_provider_request` can't block LLM calls; bun-bundled `dist/index.js` fails under stock `pi`; governance scanner trips on its own system prompt. Verify with `pi -e src/index.ts -p … </dev/null`.

- [Credentials via Pi /login only](credentials-via-pi-login.md) — no API keys in env; at each gate tell the user the exact command, they `/login`; probes use `~/.pi/agent/auth.json` (currently openai-codex → gpt-5.5).

- [BlitzPi launcher facts](blitzpi-launcher-facts.md) — `bin/blitzpi.ts`→`src/launcher.ts` spawns Pi's cli.js with `-e src/index.ts`; `bun link`; sendMessage invisible in `-p`; `audit.getPath()` is a dir.

- [Self-contained installer](self-contained-installer.md) — private Bun + versions/ + current symlink; ln -sfn trap; needs a GitHub release; BLITZPI_SOURCE for local tests

## References

(External resources, APIs, dashboards)
