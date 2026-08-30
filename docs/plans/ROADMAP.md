# Roadmap — updatable attack detection (feeds)

Source: `docs/audit/01-attack-detection-feeds.md`. Parked work: `docs/BACKLOG.md`. Definition of done for every item:
the real CLI blocks/observes the thing live (headless probe + audit entry), tests cover the parsing/decision, evidence is
recorded here, **and the user confirms**. Every feed starts in `monitor` unless its false-positive rate is near zero.

## Phase 1 — NOW: package feed (OSV) + the feeds layer

**Status 2026-08-30: built and verified live — user confirmation needed.** Evidence (headless `blitzpi -p` in a fresh
workspace, audit entries in `~/.blitz/audit`): `bun add @0xengine/xmlrpc` → `[BLOCKED] package feed: npm "@0xengine/xmlrpc"
is a known malicious package (MAL-2024-11182: Malicious code in @0xengine/xmlrpc (npm))`, audit `feed_check allowed:false`
✔ · `bun add is-odd` → installed, `feed_check allowed:true` ✔ · `BLITZ_OSV_API=http://127.0.0.1:9` + `bun add is-even` →
installed, `feed_unreachable … fetch failed` ✔ · `feeds.packages: monitor` with a local mock OSV flagging `is-number` →
installed, `feed_check mode:monitor allowed:true malicious:["npm:is-number"]` ✔ · TUI (pty): banner `packages osv (enforce)`,
panel row `● Package feed (OSV)`, `/blitz-security packages` ✔ · `blitzpi feeds check @0xengine/xmlrpc lodash pypi:requests`
→ `✗ MALICIOUS … MAL-2024-11182`, `✓ clean`, `✓ clean`, exit 3 ✔ · Jest 151 passed (12 new in `tests/feeds.test.ts`) ✔.
`pip install tcloud-python-sdks` → `[BLOCKED] package feed: PyPI "tcloud-python-sdks" is a known malicious package
(MAL-2025-191887 …)`, audit `feed_check allowed:false` ✔ (blocked before exec — pip is not even installed on this machine).
crates/gem/go: parser unit-tested; the OSV path is ecosystem-agnostic (same request), no live probe ✔ by construction.
No `⚠` outstanding — phase 1 gate passes pending the user's confirmation.
| ID | What | Gap | Sev | Verify |
|---|---|---|---|---|
| F1 | `src/feeds/`: parse package-install commands (bun/npm/npx/pnpm/yarn/pip/pipx/cargo/gem/go) into `{ecosystem, name}`; query OSV `querybatch`; block on any `MAL-*` (malicious), never on GHSA/CVE advisories; local cache (`~/.blitz/feeds/osv-cache.json`, 24 h TTL); unreachable → allow + audit `feed_unreachable` (never enforce an outage) | AD-2, AD-8, AD-9 | high | unit tests on the parser + decision; headless probe `bun add @0xengine/xmlrpc` → `[BLOCKED]` + audit `feed_check … MAL-2024-11182`; `bun add is-odd` → allowed; API pointed at a dead port → allowed + `feed_unreachable` |
| F2 | Config `feeds.packages: enforce \| monitor \| off` (default enforce); "Package feed (OSV)" layer in `/blitz-security` and the banner; counter `blocked.feed` | AD-11 | med | `/blitz-security` panel shows the layer with its mode (pty capture); monitor mode audits and shows but does not block (headless probe) |
| F3 | `blitzpi feeds` CLI: `status` (sources, cache size/age), `check <pkg…>` (query without installing), `clear-cache`; audit entry per check | AD-11 | med | shell output on real packages |

## Phase 2 — pulled dictionaries (feed store)
| ID | What | Gap | Sev | Verify |
|---|---|---|---|---|
| F4 | Feed store: `~/.blitz/feeds/<name>/` with `manifest.json` (source, ref/ETag, sha256, fetched_at) + compiled `rules.json` in one native shape; `blitzpi feeds update \| list \| rollback`; previous compiled version kept; every update audited; compile failure keeps the previous feed | AD-7 | high | update/rollback on a real source; corrupt download → previous kept |
| F5 | gitleaks adapter → secrets in commands/URLs, per-rule ids, **monitor** | AD-3 | med | a fake AWS key in a command → audited, shown, not blocked |
| F6 | Sigma `linux/process_creation` adapter → command shapes, **monitor**; `blitzpi report` shows hit counts per rule so FP rate is measurable before enforce | AD-1 | med | reverse-shell command → audited; a normal `bun test` → silent |
| F7 | URLhaus adapter → URLs in commands, **monitor → enforce** after a week of clean reports | AD-4 | med | a listed URL in `curl` → audited/blocked per mode |

## Phase 3 — content-side injection (monitor only)
| ID | What | Gap | Sev | Verify |
|---|---|---|---|---|
| F8 | `tool_result` scan of read file / fetched content against a jailbreak corpus feed, **monitor only**, surfaced as "this content contains injection-shaped text" | AD-5 | low | a README with "ignore previous instructions" → notice + audit, turn continues |

## Parked (see docs/BACKLOG.md)
Compiled feed bundle built in CI (needed only if an offline npm dictionary is ever required); model-based injection classifiers; org mirror / governance-endpoint distribution of feeds; version-aware OSV vulnerability (GHSA) checks.
