# 01 — Attack detection: static patterns, no updatable sources (2026-08-30)

**Reference:** the ask — "pull in libraries or dictionaries that are updated regularly so we can use them in the attack detection" — plus the security promise in `CLAUDE.md` (enforce access profiles, gate model calls, confine I/O).

## Lens: coverage vs the reference
- ✔ **AD-1** All detection is hand-written and static: 16 prompt-injection regexes, 5 PII regexes, 2 tier-2 heuristics (`src/threat-detection.ts:9-33`), 5 dangerous command shapes (`src/bash-guard.ts:6-14`). Nothing is fetched or refreshed. *Severity: high — stale by design.*
- ✔ **AD-2** Package installs are unchecked. `bun add` / `npm i` / `pip install` run under the sandbox with network, and nothing looks at the package name. OSV lists >100,000 malicious npm packages (`ossf/malicious-packages` tree, probed 2026-08-30: truncated at 100k entries). *Severity: high — the most concrete attack surface a coding agent has.*
- ✔ **AD-3** Secrets in commands are *observed*, never matched against a maintained rule set (`api_key` regex only, `threat-detection.ts:31`). gitleaks maintains ~150 rules. *Severity: medium.*
- ✔ **AD-4** URLs are recorded since 1.2.0 (`bash_exec.urls`) but never checked against a blocklist (URLhaus, OpenPhish). *Severity: medium.*
- ✔ **AD-5** Prompt injection is scanned only on the user's prompt and tool *inputs*; content the agent *reads* (files, pages) is never scanned — by design (1.1.1: content scanning blocked normal writes). A maintained corpus would only be useful on `tool_result` in monitor mode. *Severity: low for now; high false-positive risk.*

## Lens: completeness / wiring
- ✔ **AD-6** The external governance providers (openai-moderation, guardrails, custom webhook) are the only "updated" detection, and they see the model call, not tool calls. No provider sees `bun add <pkg>`.

## Lens: security (of the feed mechanism itself)
- ✔ **AD-7** Any auto-pulled rule set is a supply-chain input into the enforcer: it must be pinned/checksummed, audited on update, and roll back — none of that exists (no feed store).
- ✔ **AD-8** An unreachable source must never *enforce* (established policy for governance: `api_error` is shown, not enforced — `CHANGELOG 1.1.4`). Feeds must follow the same rule.

## Lens: reuse
- ✔ **AD-9** Pulling a package name dictionary is not viable for npm: OSV's `npm/all.zip` is 221 MB, the ossf repo 273 MB, the GitHub trees API truncates at 100k and allows 60 calls/h unauthenticated (probed). **OSV's query API** (`POST /v1/querybatch`, no auth, ~200 ms) is current and precise: `@0xengine/xmlrpc → MAL-2024-11182`, `flatmap-stream → MAL-2025-20690`, `lodash → no MAL (10 GHSA)` (probed 2026-08-30). Reuse it rather than building a dictionary pipeline.
- ✔ **AD-10** Small sources *can* be pulled as dictionaries: gitleaks `gitleaks.toml` (TOML, ~100 KB), Sigma `rules/linux/process_creation` (YAML), URLhaus CSV. Sizes to be re-probed when built.

## Lens: flow / UX
- ✔ **AD-11** There is no user-visible "detection sources" state: `/blitz-security` lists layers, none is a feed; no command to update, list or roll back sources.

## Contradictions between lenses
- Coverage wants a dictionary for packages (AD-2); reuse says a dictionary for npm is infeasible (AD-9). Resolved in the roadmap: online OSV query with a local cache for packages; pulled dictionaries for the small feeds.
