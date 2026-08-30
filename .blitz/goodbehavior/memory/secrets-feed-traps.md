# Secrets feed (gitleaks) — traps

- **gitleaks allowlists the documentation keys.** `AKIAIOSFODNN7EXAMPLE` (and other `…EXAMPLE` keys) never match — the rule's `[[rules.allowlists]]` excludes them. For probes use a made-up key that fits `AKIA[A-Z2-7]{16}`, e.g. `AKIAZZ7XQ2BR4TSTKEYA`.
- **Consent needs an answer.** In `install.sh`, `read -r ans </dev/tty` returns EOF (not a blank line) when there is no interactive terminal; `${ans:-Y}` then turned EOF into "yes" and the smoke test installed feeds without consent. `read … || return 1` fixes it. Same shape as the platform `confirm()` — that one is protected by `--yes` on updates.
- gitleaks regexes are Go RE2: `(?i)` inline flags must become the JS `i` flag; 220/222 compile (`jwt-base64` uses Go-only syntax, `pkcs12-file` is a path rule). Skipped rules are counted in the manifest, never silently dropped.
- `smol-toml` was only a *transitive* dependency in Pi's tree — declared in our `package.json` so installed copies are guaranteed to have it.
- A monitor-mode secret hit means the command **runs**, so `bash_exec` would log the credential; `redactCommand()` (secrets.ts) is applied by every audit writer that stores a command. Verify with `grep -c <key> <session audit file>` → 0.
- Live feed probes: `blitzpi feeds update` is a no-op when the ETag matches; use `--force` to create a `previous/` for rollback tests.
