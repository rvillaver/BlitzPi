---
name: per-call-governance-enforcement
description: How per-call LLM governance actually enforces in Pi 0.84.3 (ctx.abort() inside before_provider_request) and the trap that made it loop 4195 times (pi.sendMessage enters the LLM context and re-triggers a turn; use pi.appendEntry for notices). 2026-08-30, v1.1.4.
metadata:
  type: project
---

**Fact:** `before_provider_request` cannot deny by return value, but `ctx.abort()` inside it aborts the run's signal
before the request is sent — the call never happens and Pi ends the turn with "Request was aborted". That is the
provider-wrapper-free enforcement (`governance.mode: enforce`). `api_error` decisions are never enforced.

**Trap:** posting the denial with `pi.sendMessage({display:true})` puts the notice in the LLM context; Pi then
triggers a new turn → new provider call → denied again → another notice … (observed 4195 denials in enforce, 124 in
monitor). Notices the model must not act on go through `pi.appendEntry(type, data)` + `pi.registerEntryRenderer`
(TUI-only, not in context) plus `ctx.ui.notify`.

**How to verify:** `scratch gov-deny-after-tool.ts` — a webhook that approves the first call of a run and denies the
rest; `governance.provider: custom`, `api_endpoint` → a prompt that uses a tool then answers. Enforce: 2 checks,
1 enforced denial, no final answer, ~5 s. Monitor: 3 checks, 2 denials, final answer present.
