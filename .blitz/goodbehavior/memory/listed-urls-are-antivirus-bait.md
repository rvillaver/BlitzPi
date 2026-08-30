# Listed URLs are antivirus bait — never in clear, anywhere

- A live URLhaus URL written into `docs/plans/ROADMAP.md` (as probe evidence) got the *installed copy* quarantined by antivirus on macOS after `blitzpi update` — the version tarball ships `docs/`. AV engines consume URLhaus; any file containing a listed URL is flagged.
- Rule: **defang** (`hxxp://`, `host[.]tld`) everywhere a listed URL is written or shown — docs, CHANGELOG, memory, audit entries, block reasons, TUI notices, CLI output, test logs. `defangUrl()` in `src/feeds/adapters/urlhaus.ts`; `registerRedactor` (secrets.ts) applies it to audited commands.
- The URL feed stores 128-bit hashes (`urlHash`) of normalised URLs/hosts; raw downloads are never kept for any feed. The smoke test greps `~/.blitz/feeds` for the listed host and must find nothing.
- Probe evidence in docs: describe the hit, don't paste the URL. Test fixtures use TEST-NET (`203.0.113.x`) / `.example` only.
