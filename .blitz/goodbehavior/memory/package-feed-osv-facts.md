# Package feed: why OSV's API, and the traps

- A pulled malicious-package **dictionary is not viable for npm**: OSV `npm/all.zip` = 221 MB, `ossf/malicious-packages` = 273 MB, its `osv/malicious/npm` tree has >100,000 entries (GitHub trees API truncates at 100k; 60 unauthenticated calls/h). The GCS listing (`storage.googleapis.com/storage/v1/b/osv-vulnerabilities/o?prefix=npm/MAL-`) is public but only yields ids, not names. `POST https://api.osv.dev/v1/querybatch` (no auth, ~200 ms) is the feed.
- **Only `MAL-*` ids mean malicious.** `lodash` returns 10 GHSA ids; blocking on any id would block every popular package. Version-aware advisory checks are backlog.
- `GET /v1/vulns/<id>` gives `summary` and `withdrawn`; withdrawn entries must not block.
- Known-malicious names for live probes: `@0xengine/xmlrpc` (MAL-2024-11182), `flatmap-stream` (MAL-2025-20690), PyPI `tcloud-python-sdks` (MAL-2025-191887). Clean, tiny: `is-odd`, `is-even`, `is-number`.
- **Cache trap in live tests:** verdicts are cached 24 h in `~/.blitz/feeds/osv-cache.json`; a mock OSV (`BLITZ_OSV_API=http://127.0.0.1:<port>`) is only consulted for names not already cached — use a fresh name or `blitzpi feeds clear-cache` first.
- Register the feeds `tool_call` hook **before** `setupSandboxedBash` so a malicious install is refused before the gate asks the user.
- `bun add` in print mode under bwrap installs fine (network kept); bun does not run lifecycle scripts of untrusted deps, but don't install a real malicious package in monitor-mode probes anyway — mock the feed.
- Custom-message panels render markdown: `MAL-*` shows as `MAL-` — avoid `*` in status text.
