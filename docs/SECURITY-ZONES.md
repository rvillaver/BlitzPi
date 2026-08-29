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
| **global** | `~/.blitz/` | the cross-project **audit trail** + global defaults |
| **system** | `/usr`, `/bin`, `/etc`, `/lib`, … | the OS and tools the agent legitimately reads |
| **plumbing** | `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/tty`, … | I/O plumbing, not data |
| **other** | everything else (`~/.ssh`, other projects) | not yours, not BlitzPi |

The **project anchor** is the folder you launched in. If it has no `.blitz/`, it's the root of a new
project (you're asked to set it up). No walking up to parents.

## Permission ladder

Each (action, zone) resolves to one level:

| | read | write |
|---|---|---|
| project / goodbehavior | silent | **ask** |
| project-config | silent | **ask (no "Always")** — the agent can't blanket-loosen its own rules |
| plumbing | silent | silent |
| system / install / global / other | **ask** | **dangerous** |

- **silent** — no prompt.
- **ask** — prompt: **Yes / No / Always this session / Always**.
- **dangerous** — shown **in red with a warning**; prompt **Yes / No**. You can still allow it.
- Dangerous command *shapes* (`sudo`, `curl | sh`, reverse shells, `rm -rf /`) are always dangerous.

**Non-interactive runs** (`-p`, unattended): silent/ask auto-allow; **dangerous is refused** (no human to warn).

Every decision is written to the audit trail.

## The two-layer rule

- The **sandbox confines the coding flow** to the project. Approved out-of-project actions run
  unconfined (you allowed the escape); in-project actions run under the OS backend
  (bwrap on Linux, Seatbelt on macOS).
- The **security layer is exempt** — it reads its own install to run, and writes the global audit
  (`~/.blitz/audit`) itself, without asking. It is the enforcer, not the enforced.
- **Audit** is global; **project policy and GoodBehavior data** live in the project; **BlitzPi's code**
  is reference-only and never "the project".
