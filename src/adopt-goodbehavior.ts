/**
 * GoodBehavior adoption — copies the shipped skills + profile(s) into the user's project, and removes them again.
 *
 *   <project>/.pi/skills/<skill>/SKILL.md            the 7 skills (Pi loads project skills from here)
 *   <project>/.blitz/goodbehavior/profiles/<name>.md  the doctrine (injected into the system prompt)
 *   <project>/.blitz/goodbehavior/memory/MEMORY.md    project learnings (never overwritten, kept on unadopt)
 *   <project>/.blitz/goodbehavior/manifest.json       sha256 of every file as shipped — how re-adopt tells
 *                                                     "untouched, safe to update" from "the project changed this"
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const GB_SKILLS = [
  "audit-goodbehavior",
  "roadmap-goodbehavior",
  "gate-build-goodbehavior",
  "verify-goodbehavior",
  "learn-goodbehavior",
  "uatplan-goodbehavior",
  "draft-profile-goodbehavior",
];
/** Skills shipped by older versions; removed on unadopt/re-adopt if still untouched. */
const RETIRED_SKILLS = ["update-goodbehavior"];

const INSTALL_ROOT = path.join(__dirname, "..");
export const shippedSkillsDir = () => path.join(INSTALL_ROOT, ".pi", "skills");
export const shippedProfilesDir = () => path.join(INSTALL_ROOT, ".pi", "goodbehavior", "profiles");

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Manifest { source: string; adoptedAt: string; files: Record<string, string> }
const manifestPath = (cwd: string) => path.join(cwd, ".blitz", "goodbehavior", "manifest.json");
function readManifest(cwd: string): Manifest {
  try { return JSON.parse(fs.readFileSync(manifestPath(cwd), "utf-8")); } catch { return { source: "", adoptedAt: "", files: {} }; }
}

export function isAdopted(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, ".pi", "skills", "audit-goodbehavior", "SKILL.md"));
}

export interface AdoptResult { installed: string[]; updated: string[]; kept: string[]; removed: string[] }

/** Adopt (first time) or update (re-run). Files the project edited are kept and reported, never overwritten. */
export function adoptGoodBehavior(cwd: string): AdoptResult {
  const res: AdoptResult = { installed: [], updated: [], kept: [], removed: [] };
  const prev = readManifest(cwd);
  const next: Manifest = { source: `blitzpi ${require(path.join(INSTALL_ROOT, "package.json")).version}`, adoptedAt: new Date().toISOString(), files: {} };

  const place = (src: string, rel: string) => {
    const dest = path.join(cwd, rel);
    const srcHash = sha(src);
    if (fs.existsSync(dest)) {
      const cur = sha(dest);
      if (cur === srcHash) { /* identical */ }
      else if (prev.files[rel] && prev.files[rel] === cur) { fs.copyFileSync(src, dest); res.updated.push(rel); }
      else { res.kept.push(rel); next.files[rel] = cur; return; }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      res.installed.push(rel);
    }
    next.files[rel] = srcHash;
  };

  for (const name of GB_SKILLS) {
    const dir = path.join(shippedSkillsDir(), name);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) place(path.join(dir, f), path.join(".pi", "skills", name, f));
  }
  for (const f of fs.readdirSync(shippedProfilesDir())) place(path.join(shippedProfilesDir(), f), path.join(".blitz", "goodbehavior", "profiles", f));

  // retired skills: remove only if the project never changed them
  for (const name of RETIRED_SKILLS) {
    const dir = path.join(cwd, ".pi", "skills", name);
    if (!fs.existsSync(dir)) continue;
    const rel = path.join(".pi", "skills", name, "SKILL.md");
    const untouched = !prev.files[rel] || (fs.existsSync(path.join(cwd, rel)) && sha(path.join(cwd, rel)) === prev.files[rel]);
    if (untouched) { fs.rmSync(dir, { recursive: true, force: true }); res.removed.push(rel); } else res.kept.push(rel);
  }

  const memDir = path.join(cwd, ".blitz", "goodbehavior", "memory");
  fs.mkdirSync(memDir, { recursive: true });
  const memIndex = path.join(memDir, "MEMORY.md");
  if (!fs.existsSync(memIndex)) fs.writeFileSync(memIndex, "# Project Memory\n\nDurable learnings for this project — one fact per file, linked here.\n");

  fs.mkdirSync(path.dirname(manifestPath(cwd)), { recursive: true });
  fs.writeFileSync(manifestPath(cwd), JSON.stringify(next, null, 2));
  return res;
}

/** Remove GoodBehavior from the project. Memory is kept unless `purgeMemory`. */
export function unadoptGoodBehavior(cwd: string, purgeMemory = false): string[] {
  const removed: string[] = [];
  for (const name of [...GB_SKILLS, ...RETIRED_SKILLS]) {
    const dir = path.join(cwd, ".pi", "skills", name);
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); removed.push(path.join(".pi", "skills", name)); }
  }
  const gb = path.join(cwd, ".blitz", "goodbehavior");
  for (const sub of ["profiles", "manifest.json"]) {
    const p = path.join(gb, sub);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(path.join(".blitz", "goodbehavior", sub)); }
  }
  if (purgeMemory && fs.existsSync(path.join(gb, "memory"))) { fs.rmSync(path.join(gb, "memory"), { recursive: true, force: true }); removed.push(".blitz/goodbehavior/memory"); }
  const skillsDir = path.join(cwd, ".pi", "skills");
  try { if (fs.existsSync(skillsDir) && fs.readdirSync(skillsDir).length === 0) fs.rmdirSync(skillsDir); } catch { /* keep */ }
  try { if (fs.existsSync(gb) && fs.readdirSync(gb).length === 0) fs.rmdirSync(gb); } catch { /* keep */ }
  return removed;
}

export interface Profile { name: string; path: string; body: string; frontmatter: Record<string, unknown> }

/** The active profile: the project's copy if adopted, else the shipped one. `null` if the name doesn't exist. */
export function loadProfile(cwd: string, name: string): Profile | null {
  const candidates = [path.join(cwd, ".blitz", "goodbehavior", "profiles", `${name}.md`), path.join(shippedProfilesDir(), `${name}.md`)];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return null;
  const raw = fs.readFileSync(file, "utf-8");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  let frontmatter: Record<string, unknown> = {};
  if (m) { try { frontmatter = (require("js-yaml").load(m[1]) as Record<string, unknown>) ?? {}; } catch { frontmatter = {}; } }
  return { name, path: file, body: m ? raw.slice(m[0].length).trim() : raw.trim(), frontmatter };
}
