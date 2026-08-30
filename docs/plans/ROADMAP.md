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

## Phase 2 — pulled dictionaries (feed store) — **opt-in component, separate from the platform**

**Decision (user, 2026-08-30):** no release yet; feeds are **opt-in at install and at update** — a user may decline
security-feed updates, platform updates always go through. Feeds therefore live outside `versions/` (in
`~/.blitz/feeds/`, per user), have their own version/rollback, and never ride along with a platform release.

**Size impact, measured 2026-08-30** (raw → compiled estimate; the platform is 338 MB + 78 MB Bun for scale):

| Feed | Source | Raw | gzip | Compiled (our format) | Cadence |
|---|---|---|---|---|---|
| packages (phase 1) | osv.dev API | — | — | cache 0.6 KB → grows ~100 B/package | live |
| secrets | gitleaks `gitleaks.toml`, 222 rules | 98 KB | 21 KB | ~60 KB (regex + id + severity) | per gitleaks release |
| command shapes | Sigma `rules/linux/process_creation` 122 + `macos/process_creation` 67 rules | 214 KB | ~50 KB | ~40 KB (contains/regex strings only) | monthly release (`r2026-07-01`) |
| URLs | URLhaus `text_online` 15,830 URLs → **1,834 unique hosts**; OpenPhish 300 URLs | 1.3 MB + 20 KB | 307 KB + 5 KB | ~60 KB (host set) — or 1.3 MB if full URLs kept | hourly / hourly |
| **Total on disk** | | | | **≈ 0.2 MB compiled, ≈ 2 MB if raw sources are kept for rollback** | |

Conclusion: negligible against a 416 MB install. The cost that matters is **network + trust**, not bytes: each
`blitzpi feeds update` is ~0.4 MB of downloads, and every feed is an input to the enforcer — pinned, checksummed,
audited, rollback-able (F4). Not proposed: Sigma's full `sigma_all_rules.zip` (3.2 MB, mostly Windows) or URLhaus
`csv_online` (3.9 MB) — we take the Linux/macOS process-creation subset and the host set.

**Opt-in mechanics (to build in F4):**
- `install.sh`: after the platform install, `Install security feeds (secrets, command shapes, URLs — ~0.4 MB download)? [Y/n]`;
  flags `--feeds` / `--no-feeds` for non-interactive; the answer is remembered in `~/.blitz/feeds/opt-in` (per user).
- `blitzpi update` (platform): always updates the platform; then, only if opted in, asks `Update security feeds too? [Y/n]`
  (`--no-feeds` skips, `--feeds` forces; the `blitzpi update` shim path passes `--yes` for the platform only).
- `blitzpi feeds update | list | rollback | opt-in | opt-out`: the feeds' own lifecycle, independent of platform versions.
- Not opted in ⇒ the dictionary feeds are simply absent: the layers show `off (not installed — blitzpi feeds opt-in)`;
  the OSV package feed and the built-in patterns keep working (no download needed).
- Platform rollback never touches feeds; feed rollback never touches the platform.
| ID | What | Gap | Sev | Verify |
|---|---|---|---|---|
**F4 + F5 status 2026-08-30: built and verified live — user confirmation needed.** Evidence: `blitzpi feeds opt-in` → `secrets
updated 220 rules (2 skipped) 95 KB sha256 e163e53b…` ✔ · `feeds update` again → `unchanged` via ETag ✔ · `feeds update --force`
then `feeds rollback secrets` ×2 → swaps recorded as `feed_update` / `feed_rollback` audit entries ✔ · `feeds scan 'curl -u
x:ghp_…'` → `curl-auth-user`, `github-pat`, exit 3 ✔ · headless monitor: `echo token=AKIA…` ran, audit `feed_secret
mode:monitor allowed:true hits:[aws-access-token, generic-api-key]`, `bash_exec.command` = `echo token=AKIA…************…KEYA`,
raw key occurs **0** times in the session's audit file ✔ · headless enforce (`feeds.secrets: enforce`): `[BLOCKED] secrets feed:
the command contains a credential — aws-access-token (AKIA…KEYA)` ✔ · TUI (pty): banner `secrets gitleaks (monitor)`, panel
`◐ Secrets feed (gitleaks) monitor` ✔ · installer smoke **49/49**: no consent without an answer (found + fixed: EOF used to
default to "yes"), `feeds status` says not opted in, `feeds update` refuses without opt-in, `feeds opt-in` downloads + compiles,
`update --no-feeds` leaves feeds alone, `update --feeds` refreshes after the platform ✔ · Jest 160 passed ✔.

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
