# Architecture

On first run in an un-initialized folder BlitzPi asks to set it up as a project (`.blitz/` marker + trust). `blitzpi` is the single command: the agent, plus `blitzpi audit` / `blitzpi demo` utilities. Everything
else passes through to Pi. The 7 GoodBehavior skills follow Pi convention (`<project>/.pi/skills/`), but
`syncSkills()` keeps them synced there automatically on every extension setup — no `/adopt-goodbehavior` command,
no restart, self-healing before Pi's own skill scan for that session. Only the GoodBehavior *profile*
(`<project>/.blitz/goodbehavior/profiles/<name>.md`, what "done" means for this project) is a deliberate, per-project
choice; `/adopt-goodbehavior` manages that alone.

BlitzPi = the real Pi agent + the Blitz extension, loaded from source. No build.

```
blitzpi (bin/blitzpi.ts) ──> src/launcher.ts
    spawns: bun <pi>/dist/bundle/cli.js -e <repo> -e <bundled pi packages> [args]
                                          │
                                          ▼
                    Pi core (tools, LLM routing, TUI, sessions)
                                          │  extension hooks
                                          ▼
                    src/index.ts  (registers every Blitz layer)
```

`blitzpi` is Pi rebranded via a committed `bun patch` (`patches/…pi-coding-agent@<ver>.patch`,
`piConfig.name = "blitzpi"`); `bun install` re-applies it. The repo itself is a Pi package
(`package.json` `"pi"`: the extension and themes; no skills ship globally).

## Layers (all in `src/`)

| File | Layer | Pi hook |
|---|---|---|
| `caller.ts`, `audit.ts` | identity + JSONL audit trail | — |
| `config.ts` | load + layer `.blitz/blitz.config.yaml` (global then project); system prompt | `before_agent_start` |
| `permissions.ts`, `permission-gate.ts` | zone → permission-level ladder, per security tier | `tool_call` (bash + file tools) -> confirm/block |
| `security-level.ts`, `security-level-onboard.ts` | `security_level` read/write (`blitzpi level`, `/blitz-level`) + first-run tier question | `session_start`, `registerCommand` |
| `access-profiles.ts` | tool allow/deny per profile | `tool_call` -> `{block}` |
| `sandbox.ts` | file-tool workspace confinement | `tool_call` -> `{block}` |
| `bash-guard.ts` | cross-platform command classifier (allow/confirm/deny) | `tool_call` (bash) -> confirm/block |
| `sandbox-backends.ts` | bash execution isolation (bwrap / sandbox-exec / pinned) | `registerTool("bash")` override |
| `sandbox-bash.ts` | wires the guard + backend to the bash tool | — |
| `governance.ts`, `governance-providers/*` | prompt gate + per-call audit | `input` -> `{action:"handled"}`; `before_provider_request` (audit only) |
| `threat-detection.ts` | pattern injection/PII detection | `tool_call` -> `{block}` |
| `providers/` (+ `pi-commandcode-provider`) | Command Code models | `registerProvider` |
| `ui/blitzpi-branding.ts` | banner, title, `/blitz-*` live-state commands | `session_start`, `registerCommand` |
| `goodbehavior/*` | ships GoodBehavior skills + done-gate | `agent_end` |
| `cli.ts`, `cli-demo.ts` | `blitzpi audit` / `blitzpi demo` shell utilities | — |

## Enforcement points in Pi 0.84.x

- **Can block:** `tool_call` (`{block:true, reason}`) and `input` (`{action:"handled"}`).
- **Cannot block:** `before_provider_request` — it can only rewrite the payload; used for audit only.
  There is **no `llm_call` event**. Per-call mid-loop blocking would need a `registerProvider` wrapper.

## Adding a bash sandbox backend (e.g. Windows)

Implement `SandboxBackend` in `src/sandbox-backends.ts`:

```ts
interface SandboxBackend {
  name: string;
  hardened: boolean;                 // true = OS-level isolation
  describe(runDir: string): string;
  exec(command: string, runDir: string, options: ExecOptions): Promise<{ exitCode: number | null }>;
}
```

Add it to `selectBackend(pref)` (and the `BackendPref` union + `config.sandbox.backend`). The guard
(`bash-guard.ts`) already runs cross-platform on top of any backend. Windows target: AppContainer — Windows has the primitive but no built-in CLI wrapper, so it needs a native helper.

## Verifying changes

- **Unit/integration:** `bun run test` (jest). Real enforcement: `BLITZ_E2E=1 bun run test`.
- **Install end-to-end:** `bash scripts/smoke-test.sh` (per-OS bash-sandbox proof; prints the commit).
- **TUI-only behavior (themes, header, `/commands`):** must be driven through a real pty —
  `blitzpi -p` (print mode) does NOT load the TUI/themes/header. Use `tests/tools/pty-smoke.py`.

## Platform & framework notes

- **Verify on the real platform / real TUI.** `-p` skips themes+header; piping stdin into `blitzpi`
  makes Pi non-interactive. Use the pty harness for anything visual, and run OS-sandbox checks on that OS.
- **Don't commit `dist/` or bundle Pi** into the extension — the bundle fails to load under stock `pi`;
  Pi loads `src/*.ts` natively. `bin/blitzpi.ts` must stay tracked (`.gitignore` ignores `bin/*` except it).
- **Themes need all 55 tokens** from Pi's `dist/modes/interactive/theme/dark.json`; build custom themes
  by copying Pi's and overriding the accent tokens only.
- **macOS paths:** `/etc`->`/private/etc`, `/var`->`/private/var`, `/tmp`->`/private/tmp` after realpath.
  Check workspace-containment BEFORE any system-path blocklist, or a workspace under `/private/var`
  (macOS temp) is wrongly blocked. Seatbelt profiles must use the realpath'd workspace path.
- **Governance scanner** must read user/tool text only — never the system prompt (it contains
  "jailbreak" and will false-positive on every request).
- **The startup `pi` mascot** is Pi's hardcoded splash; `setHeader` does not replace it in 0.84.x. The
  BlitzPi banner + terminal title are what we control.
- **Pi subcommands** (`auth`, `install`, `list`) must precede `-e` on the command line.
