---
name: bwrap-die-with-parent-kills-under-bun
description: bwrap --die-with-parent (PR_SET_PDEATHSIG) randomly SIGKILLs the sandbox ~130 ms after spawn when the parent is Bun/Pi, because PDEATHSIG is per-THREAD and Bun spawns from reaped pool threads; symptom "bun add hangs / exit_code null". Removed 2026-08-30 (v1.1.2); children are tracked and killed on exit instead.
metadata:
  type: project
---

**Symptom:** the agent reported `bun add`/`bun install` "hangs" in the sandbox; the `bash_exit` audit showed
`exit_code: null, aborted: false, ms: ~132` and `echo exit=$?` after the command never ran (the whole sandbox died).
Direct backend calls from a short script worked; through Pi's tool ~50% died. `| cat` variants "worked" by luck of timing.

**Cause:** `bwrap --die-with-parent` = `prctl(PR_SET_PDEATHSIG)`, which fires when the spawning *thread* exits, not
the process. Bun runs spawn on pool threads that are reaped after idling → SIGKILL to bwrap → everything inside dies.

**Fix / how to apply:** never use `--die-with-parent` (or any PDEATHSIG-based mechanism) from a Bun/Node parent.
`src/sandbox-backends.ts` tracks children and kills them on abort / `process.on("exit")` / SIGINT/SIGTERM/SIGHUP;
`--unshare-pid` makes bwrap the init of its namespace so killing it kills the tree. **Diagnose fast:** look at
`bash_exit` in `~/.blitz/audit` — `exit_code: null` with `aborted: false` means an external signal.
