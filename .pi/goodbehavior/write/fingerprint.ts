#!/usr/bin/env bun
/*
 * Rule fingerprint — extracts every OBLIGATION a document imposes, so a prose rewrite can be proved
 * not to have dropped one. Deterministic: obligation clauses (never/must/don't/always/...), bolded
 * spans, and headings, normalised to a content-word bag.
 *
 * Matching between two versions is fuzzy (Jaccard >= 0.45 on content words) because a rewrite
 * legitimately changes wording. This is a gate that FAILS LOUDLY, not a proof: an unmatched
 * obligation means "a human must look at this", not "a rule was definitely lost".
 *
 * Usage: fingerprint.ts <file|dir>              -> JSON list of obligations
 *        fingerprint.ts --diff <before> <after> -> dropped/added report
 */
import fs from "node:fs";
import path from "node:path";

export type UnitKind = "bold" | "heading" | "obligation";
export interface Unit { kind: UnitKind; text: string; words: string[]; file: string }

const OBLIGATION = /\b(never|must|musn'?t|shall|always|don'?t|do not|cannot|can'?t|required?|refuse|forbidden|only|before|until|instead of|rather than|stop|ask|confirm)\b/i;
const STOP = new Set("a an the and or of to in is are be it its this that for on with as at by from you your we our not no if then so than them their there here what which who how when any all each every one two some more most other such own same very can will just also into out up down about".split(" "));

const words = (s: string): string[] =>
  s.toLowerCase().replace(/`[^`]*`/g, " ").replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

export function extract(file: string): Omit<Unit, "file">[] {
  const text = fs.readFileSync(file, "utf8");
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");           // drop frontmatter
  const units: Omit<Unit, "file">[] = [];
  const push = (kind: UnitKind, s: string) => {
    const w = words(s);
    if (w.length >= 3) units.push({ kind, text: s.trim().replace(/\s+/g, " ").slice(0, 160), words: w });
  };
  for (const m of body.matchAll(/\*\*([^*\n]{6,})\*\*/g)) push("bold", m[1]);
  for (const m of body.matchAll(/^#{1,6}\s+(.+)$/gm)) push("heading", m[1]);
  for (const raw of body.split(/(?<=[.!?:])\s+|\n\n+|\n(?=[-*|#])/)) {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s.length > 15 && OBLIGATION.test(s)) push("obligation", s.replace(/\*\*/g, ""));
  }
  return units;
}

const files = (p: string): string[] => fs.statSync(p).isDirectory()
  ? (fs.readdirSync(p, { recursive: true }) as string[]).map((f) => path.join(p, f)).filter((f) => f.endsWith(".md"))
  : [p];

// `file` scopes matching so a rule can't "match" its counterpart in an unrelated file. A single-file
// compare uses "" for both sides on purpose: before/after are usually two different filenames (a git
// checkout vs the working copy), and keying on basename there matched nothing and flagged every rule.
export function collect(p: string): Unit[] {
  const list = files(p), single = list.length === 1;
  const out: Unit[] = [];
  for (const f of list) for (const u of extract(f)) out.push({ ...u, file: single ? "" : path.relative(p, f) });
  return out;
}

const jac = (a: string[], b: string[]): number => {
  const A = new Set(a), B = new Set(b);
  const i = [...A].filter((x) => B.has(x)).length;
  return i / (A.size + B.size - i);
};

if (import.meta.main) {
  if (process.argv[2] === "--diff") {
    const before = collect(process.argv[3]), after = collect(process.argv[4]);
    const used = new Set<number>();
    const dropped: { file: string; kind: UnitKind; score: number; text: string }[] = [];
    for (const b of before) {
      let best = -1, bi = -1;
      after.forEach((a, i) => {
        if (used.has(i) || a.file !== b.file) return;
        const s = jac(b.words, a.words); if (s > best) { best = s; bi = i; }
      });
      if (best >= 0.45) used.add(bi); else dropped.push({ file: b.file, kind: b.kind, score: +best.toFixed(2), text: b.text });
    }
    const added = after.filter((_, i) => !used.has(i)).map((a) => ({ file: a.file, kind: a.kind, text: a.text }));
    console.log(JSON.stringify({ beforeCount: before.length, afterCount: after.length,
      droppedCount: dropped.length, addedCount: added.length, dropped, added }, null, 2));
  } else {
    console.log(JSON.stringify(collect(process.argv[2]), null, 2));
  }
}
