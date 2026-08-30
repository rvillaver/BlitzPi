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

### What "Always" remembers
- For **system / install / global**: the whole zone (`read:system`).
- For **other**: only the **directory you approved** — the nearest enclosing project (`.git`, `package.json`, …) or the
  path's own directory (`read:other:/Users/you/work/some-project`). Reading a *different* folder asks again. `/`, your
  home directory, its ancestors and top-level directories (`/Users`, `/tmp`) are too broad to remember: they ask every time
  (Yes/No only). A legacy zone-wide `read:other` entry in `.blitz/permissions.json` is ignored.

**Non-interactive runs** (`-p`, unattended): silent/ask auto-allow; **dangerous is refused** (no human to warn).

Every decision is written to the audit trail.

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
