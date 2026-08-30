/**
 * URL feed at runtime: every URL a shell command names (lexically — the same extraction the audit uses) is checked
 * against the URLhaus sets. `feeds.urls: monitor` (default) records and shows; `enforce` blocks before the command
 * runs, so a listed URL is never fetched.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BlitzConfig } from "../config";
import type { AuditLogger } from "../audit";
import { stats } from "../security-status";
import { extractUrls } from "../bash-facts";
import { FeedStore, type CompiledRule } from "./store";
import { normalizeUrl, urlHash, defangUrl, defangHost } from "./adapters/urlhaus";
import { redactCommand, registerRedactor } from "./secrets";

/** `url`/`host` are DEFANGED (hxxp://, [.]) — safe to write anywhere. `raw` is the URL as seen, for matching only. */
export interface UrlHit { url: string; host: string; kind: "url" | "host"; listed: number; raw: string }

const urlSets = new WeakMap<CompiledRule, Set<string>>();
function urlSet(r: CompiledRule): Set<string> { let s = urlSets.get(r); if (!s) { s = new Set(r.set!.urls); urlSets.set(r, s); } return s; }

export function scanUrls(text: string, rules: CompiledRule[]): UrlHit[] {
  const hits: UrlHit[] = [];
  for (const u of extractUrls(text)) {
    const n = normalizeUrl(u);
    if (!n) continue;
    for (const r of rules) {
      if (!r.set) continue;
      if (urlSet(r).has(urlHash(n.key))) { hits.push({ url: defangUrl(u), host: defangHost(n.host), kind: "url", listed: 1, raw: u }); break; }
      const c = r.set.hosts[urlHash(n.host)];
      if (c) { hits.push({ url: defangUrl(u), host: defangHost(n.host), kind: "host", listed: c, raw: u }); break; }
    }
  }
  return hits;
}

/** Defang every listed URL in a text (for anything that gets audited). */
export function defangListed(text: string, rules: CompiledRule[]): string {
  let out = text;
  for (const h of scanUrls(text, rules)) out = out.split(h.raw).join(h.url);
  return out;
}

export function setupUrlsFeed(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, store: FeedStore = new FeedStore()): void {
  const mode = config.feeds.urls;
  if (mode === "off") { console.log("[Blitz:Feeds] urls feed off"); return; }
  const rules = store.optedIn() ? store.rules("urls") : undefined;
  if (!rules) { console.log(`[Blitz:Feeds] urls feed not installed (blitzpi feeds opt-in) — ${mode} configured, inactive`); return; }
  // Sets are loaded once per session; `includes` on a sorted array is fine at this size (15k) for a per-command check.
  const setRules = rules.map((r) => (r.set ? { ...r, set: { urls: r.set.urls, hosts: r.set.hosts } } : r));
  console.log(`[Blitz:Feeds] urls feed (URLhaus) ${mode}, ${setRules[0]?.set?.urls.length ?? 0} URLs`);
  registerRedactor((t) => defangListed(t, setRules));

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const tool = (event as any).toolName as string;
    if (tool !== "bash" && tool !== "powershell") return;
    const command: string = (event as any).input?.command ?? "";
    if (!command || !/:\/\//.test(command)) return;
    const hits = scanUrls(command, setRules);
    if (!hits.length) return;
    stats.feeds.urls += hits.length;
    const what = hits.map((h) => (h.kind === "url" ? `${h.url} (listed URL)` : `${h.url} (host ${h.host} listed ${h.listed}×)`)).join("; ");
    audit.log({ type: "feed_url", feed: "urls", mode, allowed: mode !== "enforce", hits: hits.map((h) => ({ url: h.url, host: h.host, kind: h.kind, listed: h.listed })), command: redactCommand(command).slice(0, 300), tool }); // defanged: nothing here trips an antivirus
    if (mode === "enforce") {
      stats.blocked.feed++;
      return { block: true, reason: `[BLOCKED] URL feed (URLhaus): ${what}. The command did not run.` };
    }
    if (ctx.hasUI) ctx.ui.notify(`Malicious URL (monitor): ${what} — recorded; feeds.urls: enforce would block it.`, "error");
  });
}
