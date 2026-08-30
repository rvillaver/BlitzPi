# URL feed (URLhaus) — facts

- Source `https://urlhaus.abuse.ch/downloads/text_online/` (CC0): **one URL per line, no header** — a header guard refuses the real list. Validate by shape (≥100 entries, ≥90% http(s) URLs; `BLITZ_FEED_URLS_MIN` lowers the floor for fixtures).
- Measured 2026-08-30: 15,837 URLs, 1,835 hosts, 7,293 on bare IPs; **34% on raw.githubusercontent.com + github.com**, then Drive/Docs/OneDrive/Dropbox/archive.org/img1.wsimg.com. Host-level matching only for hosts not in `SHARED_PLATFORMS` (adapters/urlhaus.ts); shared platforms match by exact URL.
- Live probes: use `echo <listed url>` for monitor (the feed reads the command line; no request is made) and `curl <listed url>` for enforce (blocked before it runs — verify `bash_exec` count is 0 in that session). Never fetch a listed URL for real.
- Pick a listed URL from `~/.blitz/feeds/urls/source.raw` at probe time (the list changes hourly); prefer an IP entry.
- `scripts/install-smoke.sh` can fail transiently in the platform install step (download); re-run before diagnosing.
