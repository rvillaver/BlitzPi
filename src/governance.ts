import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BlitzConfig } from "./config";
import { AuditLogger } from "./audit";
import { Caller } from "./caller";
import { MockGovernanceAPI, GovernanceRequest, GovernanceResponse } from "./governance-api";
import { checkThreatAPI, MockThreatAPI, ThreatCheckRequest } from "./threat-api";
import { createGovernanceProvider, type ProviderConfig } from "./governance-providers/factory";
import { debug } from "./log";

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
  console.log("[Blitz:Governance] Setup");

  // Initialize governance state
  runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  if (blitzCaller) {
    caller = blitzCaller;
  }
  auditLogger = blitzAuditLogger;
  config = blitzConfig;

  if (!config.governance.enabled) {
    console.log("[Blitz:Governance] Disabled in config");
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
    console.log(`[Blitz:Governance] Enabled. Provider: ${governanceProvider.name}`);
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
    if (event.source === "extension") return { action: "continue" as const };
    const text = event.text ?? "";
    if (text.startsWith("/")) return { action: "continue" as const }; // slash commands are not model prompts
    const model = ctx.model?.id ?? "unknown";
    const verdict = await decide(text, model);
    auditLogger.log({
      type: "governance_check",
      run_id: runId,
      model,
      stage: "input",
      approved: verdict.approved,
      enforced: true,
      reason: verdict.reason,
      threat_category: verdict.category,
    });
    debug("input gate:", verdict);
    if (!verdict.approved) {
      if (ctx.hasUI) ctx.ui.notify(`Blocked by governance: ${verdict.reason}`, "error");
      else console.error(`[BLOCKED] governance: ${verdict.reason}`);
      return { action: "handled" as const };
    }
    return { action: "continue" as const };
  });

  // before_provider_request cannot deny a request (Pi treats its result as a payload rewrite and
  // swallows thrown errors — audit 12.1). Until the provider-wrapper gate (ROADMAP 2.2) lands this
  // checkpoint is AUDIT-ONLY: it records the decision and shows it in the UI, never throws.
  pi.on("before_provider_request", async (event, ctx) => {
    const payload = event.payload as Record<string, unknown>;
    const model = (payload.model as string) || "unknown";
    const status = (text: string | undefined) => {
      if (ctx.hasUI) ctx.ui.setStatus("blitz-governance", text);
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
    auditLogger.log({
      type: "governance_check",
      run_id: runId,
      model,
      approved: decision.approved,
      enforced: false,
      reason: decision.reason,
      threat_category: decision.threat_category,
    });
    debug("governance decision:", decision);
    status(
      decision.approved
        ? `governance: ${governanceProvider.name} ok (audit-only)`
        : `governance: ${decision.threat_category === "api_error" ? "unreachable" : "DENIED"} (audit-only) — ${decision.reason}`,
    );
  });
}
