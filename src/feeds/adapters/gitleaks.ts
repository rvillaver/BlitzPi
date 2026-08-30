/**
 * gitleaks `gitleaks.toml` → compiled secret rules. gitleaks regexes are Go RE2; the differences that matter
 * here are inline flags (`(?i)`), which JS lacks: a leading `(?i)` becomes the `i` flag, a mid-pattern one is
 * removed and the whole rule made case-insensitive (slightly broader — fine for detection). Rules whose regex
 * still does not compile are skipped and counted, never silently dropped.
 */
import { parse } from "smol-toml";
import type { CompiledFeed, CompiledRule } from "../store";

interface GitleaksRule { id?: string; description?: string; regex?: string; keywords?: string[]; entropy?: number; allowlists?: { regexes?: string[] }[]; allowlist?: { regexes?: string[] } }

export function toJsRegex(src: string): { regex: string; flags: string } {
  let flags = "";
  let s = src;
  if (s.startsWith("(?i)")) { s = s.slice(4); flags += "i"; }
  if (/\(\?i\)/.test(s)) { s = s.replace(/\(\?i\)/g, ""); if (!flags.includes("i")) flags += "i"; }
  s = s.replace(/\(\?[ims]+\)/g, ""); // any other inline flag group: drop (rare)
  s = s.replace(/\\z/g, "$"); // Go end-of-text
  return { regex: s, flags };
}

const SEVERITY: Record<string, CompiledRule["severity"]> = { "private-key": "critical", "aws-access-token": "critical", "gcp-api-key": "critical", "github-pat": "critical", "github-oauth": "critical", "github-app-token": "critical", "gitlab-pat": "critical", "slack-bot-token": "high", "stripe-access-token": "critical", "openai-api-key": "high", "anthropic-api-key": "high" };

export function compileGitleaks(raw: string): CompiledFeed {
  const doc = parse(raw) as { title?: string; rules?: GitleaksRule[] };
  if (!Array.isArray(doc.rules)) throw new Error("not a gitleaks config: no [[rules]]");
  const rules: CompiledRule[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const r of doc.rules) {
    const id = String(r.id ?? "");
    if (!id || !r.regex) { skipped.push({ id: id || "?", reason: "no id/regex" }); continue; }
    const { regex, flags } = toJsRegex(r.regex);
    try { new RegExp(regex, flags); } catch (e) { skipped.push({ id, reason: `regex: ${e instanceof Error ? e.message : String(e)}` }); continue; }
    const allow: CompiledRule["allow"] = [];
    for (const a of [...(r.allowlists ?? []), ...(r.allowlist ? [r.allowlist] : [])]) for (const ar of a.regexes ?? []) {
      const j = toJsRegex(ar);
      try { new RegExp(j.regex, j.flags); allow.push(j); } catch { /* an uncompilable allowlist entry just narrows nothing */ }
    }
    rules.push({
      id, category: "secret", severity: SEVERITY[id] ?? "high", description: String(r.description ?? id),
      regex, flags, keywords: (r.keywords ?? []).map((k) => String(k).toLowerCase()), ...(allow.length ? { allow } : {}),
    });
  }
  return { rules, skipped, sourceVersion: doc.title };
}
