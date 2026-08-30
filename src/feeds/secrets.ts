/**
 * Secrets feed at runtime: a shell command that carries a credential (per the gitleaks rules) is recorded and
 * shown (`feeds.secrets: monitor`, the default) or blocked (`enforce`). The secret itself is never written to
 * the audit trail — only the rule id and a redacted sample. Nothing here downloads: no feed installed = off.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BlitzConfig } from "../config";
import type { AuditLogger } from "../audit";
import { stats } from "../security-status";
import { FeedStore, type CompiledRule } from "./store";

export interface SecretHit { id: string; severity: CompiledRule["severity"]; description: string; sample: string }

export function redact(s: string): string { return s.length <= 8 ? "*".repeat(s.length) : `${s.slice(0, 4)}…${"*".repeat(Math.min(12, s.length - 8))}…${s.slice(-4)}`; }

/** Keyword prefilter, then regex, then allowlists. Returns one hit per rule. */
export function scanSecrets(text: string, rules: CompiledRule[]): SecretHit[] {
  const lower = text.toLowerCase();
  const hits: SecretHit[] = [];
  for (const r of rules) {
    if (!r.regex) continue;
    if (r.keywords?.length && !r.keywords.some((k) => lower.includes(k))) continue;
    let m: RegExpExecArray | null;
    try { m = new RegExp(r.regex, r.flags ?? "").exec(text); } catch { continue; }
    if (!m) continue;
    const secret = m[1] ?? m[0];
    if (r.allow?.some((a) => { try { return new RegExp(a.regex, a.flags).test(secret) || new RegExp(a.regex, a.flags).test(m![0]); } catch { return false; } })) continue;
    hits.push({ id: r.id, severity: r.severity, description: r.description, sample: redact(secret) });
  }
  return hits;
}

/** Replace every flagged credential in a text with its redacted form — for anything that gets audited. */
export function redactSecrets(text: string, rules: CompiledRule[]): string {
  let out = text;
  const lower = text.toLowerCase();
  for (const r of rules) {
    if (!r.regex) continue;
    if (r.keywords?.length && !r.keywords.some((k) => lower.includes(k))) continue;
    let re: RegExp;
    const flags = r.flags ?? "";
    try { re = new RegExp(r.regex, flags + (flags.includes("g") ? "" : "g")); } catch { continue; }
    out = out.replace(re, (whole: string, ...groups: unknown[]) => {
      const secret = typeof groups[0] === "string" ? (groups[0] as string) : whole;
      if (r.allow?.some((a) => { try { return new RegExp(a.regex, a.flags).test(secret); } catch { return false; } })) return whole;
      return whole.replace(secret, redact(secret));
    });
  }
  return out;
}

let activeRules: CompiledRule[] | undefined;
const extraRedactors: ((text: string) => string)[] = [];
/** Other feeds register how they scrub audited text (the URL feed defangs listed URLs). */
export function registerRedactor(fn: (text: string) => string): void { extraRedactors.push(fn); }
/** Redactor for audit writers (bash_exec, feed_check …): identity until a feed that redacts is loaded. */
export function redactCommand(text: string): string {
  let out = activeRules ? redactSecrets(text, activeRules) : text;
  for (const f of extraRedactors) out = f(out);
  return out;
}

export function setupSecretsFeed(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, store: FeedStore = new FeedStore()): void {
  const mode = config.feeds.secrets;
  if (mode === "off") { console.log("[Blitz:Feeds] secrets feed off"); return; }
  const rules = store.optedIn() ? store.rules("secrets") : undefined;
  if (!rules) { activeRules = undefined; console.log(`[Blitz:Feeds] secrets feed not installed (blitzpi feeds opt-in) — ${mode} configured, inactive`); return; }
  console.log(`[Blitz:Feeds] secrets feed (gitleaks) ${mode}, ${rules.length} rules`);
  activeRules = rules;

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const tool = (event as any).toolName as string;
    if (tool !== "bash" && tool !== "powershell") return;
    const command: string = (event as any).input?.command ?? "";
    if (!command) return;
    const hits = scanSecrets(command, rules);
    if (!hits.length) return;
    stats.feeds.secrets += hits.length;
    const what = hits.map((h) => `${h.id} (${h.sample})`).join(", ");
    audit.log({ type: "feed_secret", feed: "secrets", mode, allowed: mode !== "enforce", hits: hits.map((h) => ({ id: h.id, severity: h.severity, sample: h.sample })), tool });
    if (mode === "enforce") {
      stats.blocked.feed++;
      return { block: true, reason: `[BLOCKED] secrets feed: the command contains a credential — ${what}. Use an environment variable or a secret store instead of a literal.` };
    }
    if (ctx.hasUI) ctx.ui.notify(`Secrets feed (monitor): credential in command — ${what}. Recorded; feeds.secrets: enforce would block it.`, "warning");
  });
}
