# Backlog

Forward-looking work. The core product (rebranded Pi + governance + cross-platform bash confinement) is
built and verified on Linux and macOS.

## Next
- **Windows bash isolation** — the `pinned` guard works today (via Git Bash); add a hardened backend:
  **AppContainer** (the Windows analog to bwrap/Seatbelt). Windows exposes it as an API, not a CLI, so
  it needs a small native helper (C++/Rust/.NET) that creates the AppContainer, grants the workspace
  ACL, and launches the shell. Also extend the guard to the optional `powershell` tool. Requires a
  Windows machine to build and verify.
- **npm publish** — release `@blitz/pi-coding-agent`; verify the `bun patch` survives a global install.

## Deferred (pull forward on demand)
- **Network policy for the bash sandbox** — host network is currently shared; add egress rules.
- **Advanced threat detection** — ML classifiers beyond the pattern tiers.
- **Rate limiting** in access profiles; **multi-user** profiles/audit; **audit web UI**.

## Historical scaffolding (safe to delete)
Root scripts superseded by `tests/` + `scripts/smoke-test.sh`: `test-governance.ts`,
`test-sandbox-runtime.ts`, `verify-governance.sh`, `verify-implementation.js`,
`mock-governance-server.js` (keep `mock-governance-server.ts` if you use the `custom` governance
provider). Left in place as code, not docs.
- **Pi install/update telemetry** — Pi pings `https://pi.dev/api/report-install` (`enableInstallTelemetry`, default on) and
  checks `pi.dev/api/latest-version`. The launcher now sets `PI_SKIP_VERSION_CHECK=1` (BlitzPi owns updates). Whether a
  rebranded, self-contained BlitzPi should send Pi's install ping is the owner's call (`PI_TELEMETRY` env / setting).

- **Done in 1.1.3/1.1.4** (kept for history): per-call governance enforces via `ctx.abort()`; Pi's install-dir doc
  paths stripped from the prompt; `npmCommand` pinned per workspace; real `/blitz-security`; one enforce/monitor/off vocabulary.
- **Command Code Provider API rejects CLI-minted keys** (401 "Invalid 'Authorization' header" on `/provider/v1/*` even via
  curl with a key that `/alpha/whoami` accepts). Server-side at Command Code; the provider (`pi-commandcode-provider`
  0.6.0) only falls back to `/alpha/generate` on `403 upgrade_required`. Report upstream with this evidence.
