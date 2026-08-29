---
name: credentials-via-pi-login
description: Provider credentials come only from Pi's /login (auth.json); user refuses env API keys; verify gates hand the user a launch command and wait for login
metadata:
  type: feedback
---

**Fact:** `~/.pi/agent/auth.json` is the only credential store (2026-08-29: `openai-codex` OAuth only; `settings.json` default `anthropic/claude-opus-4-8` has no credential, so Pi falls back to gpt-5.5). No provider keys in env.

**Why:** user (2026-08-29): "I dont want an api key in environment so when you are ready to test in a workspace, tell me what to run, i'll login from there."

**How to apply:** at a verify gate, print the exact command (`! bin/blitzpi` → `/login <provider>` → `/quit`), wait for the user, then run `blitzpi -p … </dev/null` probes. Command Code (ROADMAP 1.3) is verified the same way when the user logs into it. Pin probes to the provider the user logged into, not to env.
