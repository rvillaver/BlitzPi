---
name: pi-hook-and-bundle-traps
description: Two runtime traps found 2026-08-29 — Pi's before_provider_request cannot block LLM calls, and a bun-bundled dist/index.js fails to load under stock pi 0.84.3
metadata:
  type: project
---

**Fact 1 — `before_provider_request` is not a gate.** In Pi 0.84.3 its result type is `unknown` (payload replace only; `docs/extensions.md` calls it a debugging hook). Throwing inside it prints `Extension error (...)` and the request still goes out — verified live: governance printed `[GOVERNANCE DENIED]` and the model answered anyway. Blockable hooks are `tool_call` (`{block:true}`) and the provider-wrapper pattern (`registerProvider`). There is no `llm_call` event.

**Fact 2 — don't bundle the extension.** `bun build src/index.ts --outdir dist` pulls Pi + undici into a 7.6 MB `dist/index.js`; loading it with the mise-installed `pi` fails with `webidl.util.markAsUncloneable is not a function`. Pi loads TypeScript extensions natively — `pi -e src/index.ts` works. If a bundle is needed, mark `@earendil-works/pi-coding-agent` external.

**Fact 3 — scanning the whole provider payload scans your own system prompt.** `BLITZ_SYSTEM_PROMPT` contains "jailbreak", so the `/jailbreak/i` pattern fires on 100% of requests. Scan only user/tool-result text, or exclude the system message.

**Why:** All three made "verified" claims true in unit tests and false in the running agent.
**How to apply:** Verify checkpoint behavior with `pi -e src/index.ts -p "<prompt>" </dev/null` (stdin closed avoids the project-trust prompt hang) and read the audit jsonl, not the test output. See [[r6-2-skill-runner-and-commands]] for the CLI side.

**Addendum (Phase 0.7, 2026-08-29):** fixed by scanning only user/tool text (`extractScannableText`, skips `system`/`instructions`, non-user roles, metadata keys like `type`) and making the hook audit-only. A stray `node mock-governance-server.js` (started by an earlier Claude session in `~/Work/blitz-workspace`) may still be listening on :9000 and approving everything — `curl` GET says `Not found` (a response, not "down"); POST returns `{"approved":true,"reason":"Mock governance approved"}`. Check with `ss -ltnp | grep 9000` before concluding the endpoint is down. A Pi TUI session keeps the extension code it loaded at start — restart `blitzpi` after editing `src/`.

**Addendum (Phase 2/3, 2026-08-29):**
- Enforcement points that actually deny in Pi 0.84.3: `tool_call` → `{block:true}` (tools), and `input` → `{action:"handled"}` (stops a user prompt before the turn). `before_provider_request` is audit-only. Current model at input time = `ctx.model?.id` (a property, not `getModel()`; `getModel()` is on ExtensionContextActions, a different type).
- `extractScannableText` only collects strings under a user/tool role — passing a bare `{text}` returns []. For raw user input use `matchInjectionInText(text)` directly.
- Bash sandbox = override built-in bash via `createBashToolDefinition(runDir, {operations:{exec}})` and `pi.registerTool(def)`; `exec` spawns `bwrap … /bin/bash -c command`. Reuses Pi's schema/rendering/truncation. `--ro-bind-try` tolerates missing dirs. Keep net (don't `--unshare-net`) or git/curl break.
- Threat-detection tier 4 false-positives on normal bash (`echo > f && cat`); tier 2 is the sane default.
- BLITZ_SYSTEM_PROMPT was making the model REFUSE safe in-workspace ops. Tell the model the runtime enforces the sandbox so it shouldn't self-gatekeep.
