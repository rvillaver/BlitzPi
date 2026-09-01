# Security zones & permissions

BlitzPi is two layers: the **coding flow** (normal Pi doing your work) and a **security layer**
underneath it. The security layer is transparent during normal work and only surfaces to ask or warn.
The coding model is never told about it — it just gets an error if it hits a wall.

## Zones

Every path an action touches is classified into one zone:

| Zone | Where | Purpose |
|---|---|---|
| **project** | the folder you launched in (the anchor; marked by `.blitz/`) | your app's code and files |
| **project-config** | `<project>/.blitz/` | this project's security policy (profiles, permissions) |
| **goodbehavior** | `<project>/.blitz/goodbehavior/`, `<project>/.pi/skills/` | adopted GoodBehavior data & skills |
| **install** | wherever BlitzPi is installed | BlitzPi's own program — the tool, not your project |
| **global** | `~/.blitz/` | the cross-project **audit trail**, the **projects registry** (`projects.json`) + global defaults |
| **system** | `/usr`, `/bin`, `/etc`, `/lib`, … | the OS and tools the agent legitimately reads |
| **plumbing** | `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/tty`, … | I/O plumbing, not data |
| **scratch** | the OS temp dir (`/tmp`, `$TMPDIR`; macOS `/private/tmp`) | throwaway working space — logs, pids, build output |
| **other** | everything else (`~/.ssh`, other projects) | not yours, not BlitzPi |

The **project anchor** is the folder you launched in. If it has no `.blitz/`, it's the root of a new
project (you're asked to set it up). No walking up to parents.

## Permission ladder

Each (action, zone) resolves to one level:

| | read | write |
|---|---|---|
| project / goodbehavior | silent | **ask** |
| project-config | silent | **ask (no "Always")** — the agent can't blanket-loosen its own rules |
| plumbing / scratch | silent | silent |
| system / install / global / other | **ask** | **dangerous** |

- **silent** — no prompt.
- **ask** — prompt: **Yes / No / Always this session / Always**.
- **dangerous** — shown **in red with a warning**; prompt **Yes / No**. You can still allow it.
- Dangerous command *shapes* (`sudo`, `curl | sh`, reverse shells, `rm -rf /`) are always dangerous.
- A prompt always leads with the target (`Allow read? /path`). For a bash command whose extracted target doesn't
  explain itself — e.g. `/` from `find / -iname …` — a redacted, capped parenthetical shows the actual command
  (`Allow read? /  (find / -iname …)`); a file-tool prompt never needs this, its target already is the whole story.

### What "Always" remembers
- For **system / install / global**: the whole zone (`read:system`).
- For **other**: only the **directory you approved** — the nearest enclosing project (`.git`, `package.json`, …) or the
  path's own directory (`read:other:/Users/you/work/some-project`). Reading a *different* folder asks again. `/`, your
  home directory, its ancestors and top-level directories (`/Users`, `/tmp`) are too broad to remember: they ask every time
  (Yes/No only). A legacy zone-wide `read:other` entry in `.blitz/permissions.json` is ignored.

**Non-interactive runs** (`-p`, unattended): silent/ask auto-allow; **dangerous is refused** (no human to warn).

Every decision is written to the audit trail.

## Security level

The table above is the `guarded` level — BlitzPi's shipped default. `blitzpi level [strict|guarded|monitored]
[--global]` or `/blitz-level` in a session sets **how much the ladder stops to ask**, per project by default
(`--global` sets a machine-wide default other projects inherit; a project's own choice always wins over it):

| | strict | guarded (default) | monitored |
|---|---|---|---|
| project / goodbehavior write | ask | ask | **silent** (still audited) |
| outside-project read | ask | ask | **silent** (still audited) |
| project-config write | ask, no Always | ask, no Always | ask, no Always |
| package install (even a clean one) | **ask, no Always** | silent-if-clean | silent-if-clean |
| system/install/global/other write, dangerous shapes | dangerous | dangerous | dangerous |

- A known-malicious package (`feeds.packages`) is **blocked in every tier**, never merely asked about.
- A write outside the project and a dangerous command shape (`sudo`, `curl | sh`, reverse shells, `rm -rf /`)
  **stay `dangerous` in every tier** — no tier ever lets an out-of-sandbox action through silently.
- `monitored` also defaults `governance.mode` and the secrets/URL feeds to `monitor` — but only for a field
  neither the project's nor the global config names explicitly; an explicit setting at either scope always wins.
- **A non-interactive run** (`-p`, `--mode rpc|json`) always uses `guarded` for the zone ladder, regardless of
  the project's configured tier — there's no human present to extend `monitored`'s trust to.
- Asked once per project at first run (same in-app pattern as the feeds opt-in question); `blitzpi level` with
  no argument shows the active tier and where it's set (project config, global config, or the built-in default).
- Config precedence: a project's `.blitz/blitz.config.yaml` overrides individual fields on top of
  `~/.blitz/blitz.config.yaml` (a global default) — it does not replace the global file wholesale.

## The two-layer rule

- **Scratch is shared, not isolated.** The bash sandbox binds the host temp dir (bwrap) / allows writes there
  (Seatbelt), so `cmd > /tmp/out.log` followed by `read /tmp/out.log` works. Don't put secrets in `/tmp`.
- **Threat detection scans instructions, not output**: a tool call's `command`, `path`/`file`, and `url` fields.
  File content and edit text are never pattern-scanned — they are governed by zones + the sandbox.
- The **sandbox confines the coding flow** to the project. An approved out-of-project *path* is opened for
  that one command as a grant (read-only or read-write) and the command stays under the OS backend (bwrap on
  Linux, Seatbelt on macOS); `bash_exec` records the grants. Only an approved dangerous *shape* — `sudo`, a
  download piped into a shell, a reverse shell — runs unconfined, and the prompt says so.
- **Toolchain caches** live in one BlitzPi-owned root (`sandbox.cache: shared` → `~/.blitz/cache/<tool>`,
  `project` → `<project>/.blitz/cache`, `off`), routed via the package managers' cache env vars, writable in
  every confined command and classified `scratch`. The host's own caches are never opened.
- The **security layer is exempt** — it reads its own install to run, and writes the global audit
  (`~/.blitz/audit`) itself, without asking. It is the enforcer, not the enforced.
- **Audit** is global; **project policy and GoodBehavior data** live in the project; **BlitzPi's code**
  is reference-only and never "the project".
