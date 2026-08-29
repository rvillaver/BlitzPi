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
- **Per-call mid-loop LLM gating** — a `registerProvider` wrapper so every provider request (not just
  the opening prompt) can be denied. Today the `input` gate blocks prompts and every call is audited.
- **Network policy for the bash sandbox** — host network is currently shared; add egress rules.
- **Advanced threat detection** — ML classifiers beyond the pattern tiers.
- **Rate limiting** in access profiles; **multi-user** profiles/audit; **audit web UI**.

## Historical scaffolding (safe to delete)
Root scripts superseded by `tests/` + `scripts/smoke-test.sh`: `test-governance.ts`,
`test-sandbox-runtime.ts`, `verify-governance.sh`, `verify-implementation.js`,
`mock-governance-server.js` (keep `mock-governance-server.ts` if you use the `custom` governance
provider). Left in place as code, not docs.
- **Pi's system prompt points the agent at the install dir** — Pi's built-in "Pi documentation" section lists
  `<install>/node_modules/@earendil-works/pi-coding-agent/{README.md,docs,examples}` as places to read ("when the user
  asks about pi itself"). That is BlitzPi's own program directory (zone `install` → reads ask). Consider stripping that
  section in `before_agent_start` via `systemPromptOptions` so the agent has no reason to look outside the workspace.
- **`/bin/sh: npm: command not found` at startup on machines without npm** — Pi resolves `npm:`-sourced packages listed in
  the user's `~/.pi/agent/settings.json` via `npm root -g` (legacy global path lookup; `getLegacyGlobalNpmInstallPath`).
  Only fires when such packages are configured; harmless but ugly. Pi's `npmCommand` setting accepts bun
  (`["<app>/bun/bin/bun"]` → `bun pm bin -g`), which would also let `pi install npm:…` work with the private runtime.
  Decide where to set it (project `.pi/settings.json` on workspace init?) — never silently edit user settings.
- **Pi install/update telemetry** — Pi pings `https://pi.dev/api/report-install` (`enableInstallTelemetry`, default on) and
  checks `pi.dev/api/latest-version`. The launcher now sets `PI_SKIP_VERSION_CHECK=1` (BlitzPi owns updates). Whether a
  rebranded, self-contained BlitzPi should send Pi's install ping is the owner's call (`PI_TELEMETRY` env / setting).
