import { governanceStatus, stats } from "./security-status";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BlitzConfig } from "./config";
import { AuditLogger } from "./audit";
import { Caller, noteCaller } from "./caller";
import { MockGovernanceAPI, GovernanceRequest, GovernanceResponse } from "./governance-api";
import { checkThreatAPI, MockThreatAPI, ThreatCheckRequest } from "./threat-api";
import { createGovernanceProvider, type ProviderConfig } from "./governance-providers/factory";
import { debug, info } from "./log";

const PROMPT_INJECTION_PATTERNS = [
  /ignore.*(?:previous\s+)?instructions?/i,
  /bypass.*(?:system\s+)?prompt/i,
  /disregard.*(?:previous\s+)?instructions?/i,
  /override.*system\s+prompt/i,
  /role\s+play(?:ing)?/i,
  /act\s+as\s+(?:a\s+)?(?:system|admin|root)/i,
  /forget.*system\s+prompt/i,
  /new\s+instructions?:/i,
  /instead.*should/i,
  /jailbreak/i,
  /as\s+an\s+(?:AI|assistant|LLM)/i,
  /pretend.*not.*AI/i,
  /delete.*files/i,
];

let runId: string;
let caller: Caller;
let auditLogger: AuditLogger;
let config: BlitzConfig;
const mockGovernanceAPI = new MockGovernanceAPI();
const mockThreatAPI = new MockThreatAPI();

const SKIP_KEYS = new Set(["system", "instructions", "system_instruction", "systemInstruction"]);
const SCANNED_ROLES = new Set(["user", "tool", "function"]);
const META_KEYS = new Set(["type", "role", "name", "id", "tool_call_id", "call_id", "tool_use_id", "model", "status", "media_type", "format", "cache_control"]);

/**
 * Text that came from OUTSIDE the agent: user messages and tool results.
 * Never the system prompt (our own BLITZ_SYSTEM_PROMPT mentions "jailbreak" and tripped the scanner
 * on every request — audit 12.2) and never assistant turns.
 */
export function extractScannableText(payload: unknown): string[] {
  const texts: string[] = [];
  const walk = (item: unknown, inScannedRole: boolean): void => {
    if (typeof item === "string") {
      if (inScannedRole) texts.push(item);
    } else if (Array.isArray(item)) {
      for (const el of item) walk(el, inScannedRole);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const role = typeof obj.role === "string" ? obj.role : undefined;
      const scoped = role ? SCANNED_ROLES.has(role) : inScannedRole;
      if (role && !scoped) return; // system / developer / assistant message: skip entirely
      for (const [k, v] of Object.entries(obj)) {
        if (SKIP_KEYS.has(k) || META_KEYS.has(k)) continue;
        walk(v, scoped);
      }
    }
  };
  walk(payload, false);
  return texts;
}

/**
 * Check for prompt injection in the user/tool text of an LLM payload
 */
export function matchInjectionInText(text: string): string | null {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

export function detectPromptInjection(payload: Record<string, unknown>): { detected: boolean; pattern?: string } {
  for (const text of extractScannableText(payload)) {
    const hit = matchInjectionInText(text);
    if (hit) return { detected: true, pattern: hit };
  }
  return { detected: false };
}

/**
 * Setup governance provider wrapper.
 *
 * Intercepts all LLM calls through Pi's before_provider_request hook,
 * routes to governance API endpoint for approval decision,
 * and blocks or allows based on response.
 */
export function setupGovernance(
  pi: ExtensionAPI,
  blitzConfig: BlitzConfig,
  blitzAuditLogger: AuditLogger,
  blitzCaller?: Caller
): void {
  info("[Blitz:Governance] Setup");

  // Initialize governance state
  runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  if (blitzCaller) {
    caller = blitzCaller;
  }
  auditLogger = blitzAuditLogger;
  config = blitzConfig;

  if (!config.governance.enabled) {
    info("[Blitz:Governance] Disabled in config");
    return;
  }

  // Create governance provider based on config
  const providerConfig: ProviderConfig = {
    type: config.governance.provider,
    openaiApiKey: config.governance.openai_api_key,
    guardrailsEndpoint: config.governance.guardrails_endpoint,
    customEndpoint: config.governance.api_endpoint,
    modelWhitelist: config.governance.model_whitelist,
  };

  let governanceProvider: import("./governance-providers/index").GovernanceProvider;
  try {
    governanceProvider = createGovernanceProvider(providerConfig);
    info(`[Blitz:Governance] Enabled. Provider: ${governanceProvider.name}`);
  } catch (error) {
    console.error(`[Blitz:Governance] Failed to initialize provider:`, error instanceof Error ? error.message : String(error));
    return;
  }

  // ---- ENFORCEMENT: the input event CAN stop a turn before it starts (audit gap 12.1). ----
  // A prompt that fails governance (injection in the user's text, or a non-whitelisted model) never
  // reaches the provider. Mid-agent-loop provider calls are additionally recorded by the audit-only
  // hook below; blocking those per-call needs a provider wrapper (ROADMAP 2.2 / backlog).
  async function decide(userText: string, model: string): Promise<{ approved: boolean; reason: string; category?: string }> {
    const hit = matchInjectionInText(userText);
    if (hit) {
      let isThreat = true;
      let reason = `Prompt injection: ${hit}`;
      if (config.threat_api.enabled) {
        const req = { text: userText, model, caller_user: (caller || { user: "unknown" }).user };
        const td = config.threat_api.api_endpoint === "mock" ? await mockThreatAPI.check(req) : await checkThreatAPI(config.threat_api.api_endpoint, req);
        if (!td.is_threat) { isThreat = false; reason = `Pattern flagged but threat API approved: ${td.reason || "no reason"}`; }
        else reason = `Pattern + threat API: ${td.reason || hit}`;
      }
      if (isThreat) return { approved: false, reason, category: "prompt_injection" };
    }
    const decision = await governanceProvider.check({
      run_id: runId,
      caller: caller || { user: "unknown", install_type: "local", project_path: process.cwd() },
      model,
      context: { messages_count: 1, tokens_estimated: 0 },
    });
    return { approved: decision.approved, reason: decision.reason, category: decision.threat_category };
  }

  pi.on("input", async (event, ctx) => {
    // `source === "extension"` is NOT a trust signal and is deliberately not exempted.
    //
    // It means "an extension called sendUserMessage()", which says nothing about where the text came from.
    // `pi-mcp-adapter` uses it to inject an MCP server's prompt content as a user turn — text from an external
    // server, flattened and handed to the model. Exempting the whole source (the original scaffolding did, from
    // the first commit, without a recorded reason) let exactly the kind of content this gate exists to catch walk
    // straight past it. Whatever BlitzPi itself might inject later is trusted text that will simply pass the scan;
    // paying for a check is the right trade against a blanket bypass keyed on the caller rather than the content.
    const text = event.text ?? "";
    // Locally-typed slash commands are commands, not model prompts. Bridge prompts are unaffected: they always
    // arrive prefixed with `[caller …]`, so a chat message beginning with "/" cannot reach this branch.
    if (text.startsWith("/")) return { action: "continue" as const };
    const behalf = noteCaller(text); // a bridge prompt names its human: `[caller discord:123#alice]` → audit on_behalf_of
    const model = ctx.model?.id ?? "unknown";
    const verdict = await decide(text, model);
    auditLogger.log({
      type: "governance_check",
      run_id: runId,
      model,
      stage: "input",
      source: event.source ?? "interactive",
      ...(behalf ? { on_behalf_of: behalf } : {}),
      approved: verdict.approved,
      enforced: true,
      reason: verdict.reason,
      threat_category: verdict.category,
    });
    debug("input gate:", verdict);
    if (!verdict.approved) {
      if (ctx.hasUI) ctx.ui.notify(`Blocked by governance: ${verdict.reason}`, "error");
      else console.error(`[BLOCKED] governance: ${verdict.reason}`);
      stats.blocked.input++;
      return { action: "handled" as const };
    }
    return { action: "continue" as const };
  });

  // before_provider_request cannot deny a request by itself (its return value is a payload rewrite and
  // thrown errors are swallowed). Enforcement = ctx.abort(): the agent run's signal is aborted before the
  // request goes out, the model call never happens, and the turn stops with a chat message. In monitor
  // mode the decision is recorded and shown only.
  pi.on("before_provider_request", async (event, ctx) => {
    const payload = event.payload as Record<string, unknown>;
    const model = (payload.model as string) || "unknown";
    const status = (text: string | undefined) => {
      if (ctx.hasUI) ctx.ui.setStatus("blitz-governance", text ? `blitzpi - ${text}` : text);
    };

    // (Prompt-injection is enforced on the user's prompt by the input gate; we do NOT re-scan the
    // whole conversation here — reading files that merely mention "jailbreak" would false-positive.)

    // 2) governance provider decision (audit-only for now)
    const governanceRequest: GovernanceRequest = {
      run_id: runId,
      caller: caller || { user: "unknown", install_type: "local", project_path: process.cwd() },
      model,
      context: {
        messages_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
        tokens_estimated: 0,
      },
    };
    const decision: GovernanceResponse = await governanceProvider.check(governanceRequest);
    const denied = !decision.approved && decision.threat_category !== "api_error";
    const enforce = denied && config.governance.mode === "enforce";
    stats.governance.checked++;
    if (!decision.approved) {
      if (decision.threat_category === "api_error") stats.governance.unreachable++;
      else { stats.governance.denied++; stats.governance.lastDenial = decision.reason; }
    }
    auditLogger.log({
      type: "governance_check",
      run_id: runId,
      model,
      stage: "provider_request",
      approved: decision.approved,
      enforced: enforce,
      reason: decision.reason,
      threat_category: decision.threat_category,
    });
    debug("governance decision:", decision);
    // Quiet when fine (steady text), loud on an event; a denial is also posted to the chat because the
    // status bar is easy to miss — and it says what would have happened under `enforce`.
    status(governanceStatus(config));
    if (denied) {
      const content = enforce
        ? `⛔ Governance (${governanceProvider.name}) stopped a model call: ${decision.reason}\nThe request was not sent and this turn ended. Adjust .blitz/blitz.config.yaml governance.* or ask the governance owner.`
        : `⚠ Governance (${governanceProvider.name}) denied a model call: ${decision.reason}\nMode is monitor — the call went through and was audited. Under enforce it would have been stopped.`;
      if (ctx.hasUI) ctx.ui.notify(`Governance ${enforce ? "stopped" : "denied"} a model call: ${decision.reason}`, "error");
      else console.error(`[GOVERNANCE ${enforce ? "STOPPED" : "DENIED"}] ${decision.reason}`);
      // A transcript entry the model never sees: pi.sendMessage() would enter the LLM context and re-trigger
      // a turn — with a denying policy that is an infinite loop (observed: 4195 denials in one run).
      pi.appendEntry("blitz-governance", { text: content, enforced: enforce, reason: decision.reason });
      if (enforce) { stats.blocked.input++; ctx.abort(); }
    }
  });

  try {
    pi.registerEntryRenderer("blitz-governance", (entry: any, _opts: any, theme: any) => {
      const { Text } = require("@earendil-works/pi-tui");
      const t = String(entry.data?.text ?? "");
      return new Text(theme.fg(entry.data?.enforced ? "error" : "warning", t));
    });
  } catch { /* renderer unavailable (print mode / older Pi): the notify + audit entry still carry the decision */ }

  // A rejected credential is not a governance event, but it is the most confusing failure a user meets.
  pi.on("after_provider_response", async (event: any, ctx) => {
    if (event.status !== 401 && event.status !== 403) return;
    auditLogger.log({ type: "provider_auth_error", run_id: runId, status: event.status });
    if (ctx.hasUI) ctx.ui.notify(`The model provider rejected your credential (HTTP ${event.status}). Run /login to sign in again, or pick another provider with /model.`, "error");
  });
}
