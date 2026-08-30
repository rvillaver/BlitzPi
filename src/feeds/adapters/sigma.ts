/**
 * Sigma (SigmaHQ) `rules/{linux,macos}/process_creation` → compiled command-shape rules. We see one thing at
 * runtime — the command line — so the adapter keeps the Sigma fields we can evaluate (`CommandLine`, `Image` =
 * the executables named in the command) and skips, counting them, rules that require process context we do not
 * have (`ParentImage`, `User`, `LogonId`, `CurrentDirectory` …) in a positive position. A `not filter_*` that
 * needs such context evaluates to "no filter" (more hits, never fewer) — feeds start in monitor for this reason.
 * Source: the release bundle `sigma_all_rules.zip` (Detection Rule License 1.1 — attribution kept per rule).
 */
import { load } from "js-yaml";
import type { CompiledFeed, CompiledRule } from "../store";
import { readZip } from "../zip";

export interface SigmaPattern { source: string; flags: string }
export interface SigmaMatcher { field: "CommandLine" | "Image"; all: boolean; patterns: SigmaPattern[] }
export type SigmaCond = { t: "sel"; name: string } | { t: "and" | "or"; a: SigmaCond; b: SigmaCond } | { t: "not"; a: SigmaCond } | { t: "of"; count: 1 | "all"; glob: string };
export interface SigmaRule { selections: Record<string, SigmaMatcher[] | null>; condition: SigmaCond } // null = unsupported selection

const RULE_DIRS = /^rules(?:-[a-z]+)?\/(linux|macos)\/process_creation\/[^/]+\.ya?ml$/;
const FIELD_MAP: Record<string, "CommandLine" | "Image"> = { commandline: "CommandLine", image: "Image", originalfilename: "Image" };
const UNSUPPORTED_MODS = new Set(["base64", "base64offset", "utf16", "utf16le", "utf16be", "wide", "cidr", "lt", "lte", "gt", "gte", "expand", "fieldref"]);

function escapeRe(s: string): string { return s.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."); }

export function toPattern(value: unknown, mods: string[]): SigmaPattern {
  const v = String(value);
  const flags = mods.includes("cased") ? "" : "i";
  if (mods.includes("re")) { new RegExp(v, flags); return { source: v, flags }; }
  const body = escapeRe(v);
  if (mods.includes("contains")) return { source: body, flags };
  if (mods.includes("startswith")) return { source: `^${body}`, flags };
  if (mods.includes("endswith")) return { source: `${body}$`, flags };
  return { source: `^${body}$`, flags };
}

/** One Sigma selection (map of field|mods → value(s)) → matchers, or null if it needs fields we cannot evaluate. */
export function compileSelection(sel: unknown): SigmaMatcher[] | null {
  if (Array.isArray(sel)) { // list of maps = OR of maps; keep only if every map compiles (rare in our subset)
    const parts = sel.map(compileSelection);
    if (parts.some((p) => p === null)) return null;
    // OR of AND-groups is not representable in a flat matcher list; fold to a single matcher list only when each map has one matcher
    const flat = parts.flat() as SigmaMatcher[];
    if (flat.length !== parts.length) return null;
    return [{ field: flat[0].field, all: false, patterns: flat.flatMap((m) => m.patterns) }];
  }
  if (!sel || typeof sel !== "object") return null;
  const matchers: SigmaMatcher[] = [];
  for (const [key, raw] of Object.entries(sel as Record<string, unknown>)) {
    const [fieldName, ...mods] = key.split("|");
    const field = FIELD_MAP[fieldName.toLowerCase()];
    if (!field) return null;
    if (mods.some((m) => UNSUPPORTED_MODS.has(m))) return null;
    const values = Array.isArray(raw) ? raw : [raw];
    if (!values.length) return null;
    matchers.push({ field, all: mods.includes("all"), patterns: values.map((v) => toPattern(v, mods)) });
  }
  return matchers.length ? matchers : null;
}

// ---- condition grammar: expr := term (('and'|'or') term)* ; term := 'not' term | '(' expr ')' | '1 of X' | 'all of X' | name
export function parseCondition(src: string): SigmaCond {
  const toks = src.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  function term(): SigmaCond {
    const t = next();
    if (t === undefined) throw new Error("unexpected end of condition");
    if (t.toLowerCase() === "not") return { t: "not", a: term() };
    if (t === "(") { const e = expr(); if (next() !== ")") throw new Error("missing )"); return e; }
    if ((t === "1" || t.toLowerCase() === "all") && peek()?.toLowerCase() === "of") { next(); const g = next(); if (!g) throw new Error("of what?"); return { t: "of", count: t === "1" ? 1 : "all", glob: g.toLowerCase() === "them" ? "*" : g }; }
    if (/^\d+$/.test(t)) throw new Error(`unsupported count "${t} of"`);
    return { t: "sel", name: t };
  }
  function expr(): SigmaCond {
    let left = term();
    while (peek() && /^(and|or)$/i.test(peek())) { const op = next().toLowerCase() as "and" | "or"; left = { t: op, a: left, b: term() }; }
    return left;
  }
  const out = expr();
  if (i !== toks.length) throw new Error(`trailing tokens in condition: ${toks.slice(i).join(" ")}`);
  return out;
}

const globRe = (g: string) => new RegExp(`^${escapeRe(g)}$`);
function namesFor(glob: string, all: string[]): string[] { return all.filter((n) => globRe(glob).test(n)); }

/** Is any selection we cannot evaluate referenced in a positive (non-negated) position? Then the rule cannot fire correctly. */
function needsUnsupported(c: SigmaCond, sels: Record<string, SigmaMatcher[] | null>, neg = false): boolean {
  const names = Object.keys(sels);
  switch (c.t) {
    case "sel": return !neg && sels[c.name] === null;
    case "of": return !neg && namesFor(c.glob, names).some((n) => sels[n] === null);
    case "not": return needsUnsupported(c.a, sels, !neg);
    default: return needsUnsupported(c.a, sels, neg) || needsUnsupported(c.b, sels, neg);
  }
}
function referenced(c: SigmaCond, names: string[]): string[] {
  switch (c.t) {
    case "sel": return [c.name];
    case "of": return namesFor(c.glob, names);
    case "not": return referenced(c.a, names);
    default: return [...referenced(c.a, names), ...referenced(c.b, names)];
  }
}

const LEVEL: Record<string, CompiledRule["severity"]> = { informational: "low", low: "low", medium: "medium", high: "high", critical: "critical" };

export function compileSigmaRule(yaml: string, file: string): { rule?: CompiledRule; skip?: string } {
  const doc = load(yaml) as any;
  if (!doc || typeof doc !== "object" || !doc.detection) return { skip: "no detection block" };
  const id = String(doc.id ?? file);
  const det = doc.detection as Record<string, unknown>;
  const condSrc = det.condition;
  if (typeof condSrc !== "string") return { skip: "condition is not a single string" };
  let condition: SigmaCond;
  try { condition = parseCondition(condSrc); } catch (e) { return { skip: `condition: ${e instanceof Error ? e.message : String(e)}` }; }
  const selections: Record<string, SigmaMatcher[] | null> = {};
  for (const [name, sel] of Object.entries(det)) {
    if (name === "condition") continue;
    try { selections[name] = compileSelection(sel); } catch (e) { selections[name] = null; }
  }
  const refs = referenced(condition, Object.keys(selections));
  if (refs.some((r) => !(r in selections))) return { skip: `condition references unknown selection (${refs.find((r) => !(r in selections))})` };
  if (needsUnsupported(condition, selections)) return { skip: "needs process context we do not have (parent process, user, cwd …)" };
  const tags: string[] = Array.isArray(doc.tags) ? doc.tags.map(String) : [];
  return {
    rule: {
      id, category: "command", severity: LEVEL[String(doc.level ?? "medium").toLowerCase()] ?? "medium",
      description: `${doc.title ?? id}${doc.description ? " — " + String(doc.description).replace(/\s+/g, " ").slice(0, 200) : ""}`,
      sigma: { selections, condition },
      keywords: undefined,
      meta: { file, tags: tags.filter((t) => t.startsWith("attack.")).slice(0, 8), falsepositives: Array.isArray(doc.falsepositives) ? doc.falsepositives.map(String).slice(0, 4) : [], author: doc.author ? String(doc.author) : undefined, license: "DRL-1.1" },
    },
  };
}

export function compileSigma(raw: Buffer | string): CompiledFeed {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const entries = readZip(buf).filter((e) => RULE_DIRS.test(e.name));
  if (!entries.length) throw new Error("no rules/{linux,macos}/process_creation/*.yml in the bundle");
  const rules: CompiledRule[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const e of entries) {
    const r = compileSigmaRule(e.data().toString("utf-8"), e.name);
    if (r.rule) rules.push(r.rule); else skipped.push({ id: e.name.split("/").pop() ?? e.name, reason: r.skip ?? "?" });
  }
  return { rules, skipped, sourceVersion: `sigma_all_rules.zip (${entries.length} linux/macos process_creation rules)` };
}
