/**
 * Command-shapes feed at runtime: every bash/powershell command is evaluated against the compiled Sigma rules.
 * Monitor by default (`feeds.commands: monitor`): hits are audited and shown so the false-positive rate can be read
 * off `blitzpi report` before anyone turns on enforce.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BlitzConfig } from "../config";
import type { AuditLogger } from "../audit";
import { stats } from "../security-status";
import { FeedStore, type CompiledRule } from "./store";
import type { SigmaCond, SigmaMatcher } from "./adapters/sigma";
import { redactCommand } from "./secrets";

export interface CommandContext { commandLine: string; images: string[] }

/** The executables a command line names: first token of every simple command, as `/…/name` and bare. */
export function commandContext(command: string): CommandContext {
  const images = new Set<string>();
  for (const seg of command.split(/\|\||&&|;|\||\n|\$\(|`/)) {
    const toks = seg.trim().replace(/^(?:sudo|env|nohup|time|exec|nice|-\S+|\w+=\S*)\s+/g, "").split(/\s+/).filter(Boolean);
    const tok = toks[0];
    if (!tok || tok.startsWith("(") || tok.startsWith("-")) continue;
    const t = tok.replace(/^["']|["']$/g, "");
    images.add(t.includes("/") ? t : `/${t}`);
  }
  return { commandLine: command, images: [...images] };
}

function matcherHits(m: SigmaMatcher, ctx: CommandContext): boolean {
  const targets = m.field === "CommandLine" ? [ctx.commandLine] : ctx.images;
  const test = (p: { source: string; flags: string }) => { try { const re = new RegExp(p.source, p.flags); return targets.some((t) => re.test(t)); } catch { return false; } };
  return m.all ? m.patterns.every(test) : m.patterns.some(test);
}
function selectionHits(sel: SigmaMatcher[] | null, ctx: CommandContext): boolean { return sel !== null && sel.every((m) => matcherHits(m, ctx)); }
function globRe(g: string) { return new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`); }

export function evalCondition(c: SigmaCond, sels: Record<string, SigmaMatcher[] | null>, ctx: CommandContext): boolean {
  switch (c.t) {
    case "sel": return selectionHits(sels[c.name], ctx);
    case "of": { const names = Object.keys(sels).filter((n) => globRe(c.glob).test(n)); return c.count === 1 ? names.some((n) => selectionHits(sels[n], ctx)) : names.length > 0 && names.every((n) => selectionHits(sels[n], ctx)); }
    case "not": return !evalCondition(c.a, sels, ctx);
    case "and": return evalCondition(c.a, sels, ctx) && evalCondition(c.b, sels, ctx);
    case "or": return evalCondition(c.a, sels, ctx) || evalCondition(c.b, sels, ctx);
  }
}

export interface CommandHit { id: string; severity: CompiledRule["severity"]; title: string; tags?: string[] }
export function scanCommand(command: string, rules: CompiledRule[]): CommandHit[] {
  const ctx = commandContext(command);
  const hits: CommandHit[] = [];
  for (const r of rules) {
    if (!r.sigma) continue;
    if (evalCondition(r.sigma.condition, r.sigma.selections, ctx)) hits.push({ id: r.id, severity: r.severity, title: r.description.split(" — ")[0], tags: r.meta?.tags });
  }
  return hits;
}

export function setupCommandsFeed(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, store: FeedStore = new FeedStore()): void {
  const mode = config.feeds.commands;
  if (mode === "off") { console.log("[Blitz:Feeds] commands feed off"); return; }
  const initial = store.liveRules("commands");
  console.log(initial ? `[Blitz:Feeds] commands feed (Sigma) ${mode}, ${initial.length} rules` : `[Blitz:Feeds] commands feed ${mode} — not installed yet (blitzpi feeds opt-in); activates as soon as it is`);

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const tool = (event as any).toolName as string;
    if (tool !== "bash" && tool !== "powershell") return;
    const command: string = (event as any).input?.command ?? "";
    if (!command) return;
    const rules = store.liveRules("commands");
    if (!rules) return;
    const allow = new Set(config.feeds.allow ?? []);
    const hits = scanCommand(command, rules).filter((h) => !allow.has(h.id)); // per-project accepted false positives
    if (!hits.length) return;
    stats.feeds.commands += hits.length;
    const what = hits.map((h) => `${h.title} [${h.severity}]`).join("; ");
    audit.log({ type: "feed_command", feed: "commands", mode, allowed: mode !== "enforce", hits: hits.map((h) => ({ id: h.id, severity: h.severity, title: h.title })), command: redactCommand(command).slice(0, 300), tool });
    if (mode === "enforce") {
      stats.blocked.feed++;
      return { block: true, reason: `[BLOCKED] command-shapes feed (Sigma): ${what}. The command did not run.` };
    }
    if (ctx.hasUI) ctx.ui.notify(`Command shapes (monitor): ${what} — recorded; feeds.commands: enforce would block it.`, "warning");
  });
}
