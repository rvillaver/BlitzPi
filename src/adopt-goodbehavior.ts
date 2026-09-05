/**
 * GoodBehavior delivery — both PER-PROJECT, both automatic:
 *
 *   <project>/.pi/skills/<skill>/SKILL.md             the 7 skills — synced every session, no adoption, no restart
 *   <project>/.blitz/goodbehavior/skills-manifest.json untouched-vs-edited tracking for the skill sync
 *
 *   <project>/.blitz/goodbehavior/profiles/<name>.md  the doctrine (injected into the system prompt) — deliberate,
 *                                                      via /adopt-goodbehavior or draft-profile-goodbehavior
 *   <project>/.blitz/goodbehavior/memory/MEMORY.md    project learnings (never overwritten, kept on unadopt)
 *   <project>/.blitz/goodbehavior/manifest.json       sha256 of every profile file as shipped — how re-adopt tells
 *                                                     "untouched, safe to update" from "the project changed this"
 *
 * Skills need no adoption because `syncSkills()` runs on every extension setup (setupGoodBehavior, called on every
 * `blitzpi` invocation) — self-healing before Pi's own skill scan for that session, verified live: a project with
 * skills synced this way shows them active in the very same process's first run, no restart needed. Only the
 * PROFILE stays a deliberate, per-project choice (what "done" means differs by project) — that's what
 * `adoptGoodBehavior()`/`isAdopted()` are about.
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
export const shippedDoctrinePath = () => path.join(INSTALL_ROOT, ".pi", "goodbehavior", "doctrine.md");

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Manifest { source: string; adoptedAt: string; files: Record<string, string> }
function readManifestAt(file: string): Manifest {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return { source: "", adoptedAt: "", files: {} }; }
}

const manifestPath = (cwd: string) => path.join(cwd, ".blitz", "goodbehavior", "manifest.json");
const readManifest = (cwd: string) => readManifestAt(manifestPath(cwd));

/** "Adopted" means this project has its own profile — skills need no adoption, they sync automatically (see below). */
export function isAdopted(cwd: string): boolean {
  return fs.existsSync(manifestPath(cwd));
}

export interface AdoptResult { installed: string[]; updated: string[]; kept: string[]; removed: string[] }

/**
 * Copy (src, rel) pairs under `baseDir`, keeping a file the destination changed since last sync (reported, never
 * overwritten) and updating one the destination still matches the last-synced hash for. Shared by the profile sync
 * and the skill sync below — the only difference is which manifest tracks which files.
 */
function syncManagedFiles(pairs: { src: string; rel: string }[], baseDir: string, manifestFile: string, source: string): AdoptResult {
  const res: AdoptResult = { installed: [], updated: [], kept: [], removed: [] };
  const prev = readManifestAt(manifestFile);
  const next: Manifest = { source, adoptedAt: new Date().toISOString(), files: {} };
  for (const { src, rel } of pairs) {
    const dest = path.join(baseDir, rel);
    const srcHash = sha(src);
    if (fs.existsSync(dest)) {
      const cur = sha(dest);
      if (cur === srcHash) { /* identical */ }
      else if (prev.files[rel] && prev.files[rel] === cur) { fs.copyFileSync(src, dest); res.updated.push(rel); }
      else { res.kept.push(rel); next.files[rel] = cur; continue; }
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      res.installed.push(rel);
    }
    next.files[rel] = srcHash;
  }
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(next, null, 2));
  return res;
}

const blitzVersion = () => `blitzpi ${require(path.join(INSTALL_ROOT, "package.json")).version}`;

/** Adopt (first time) or update (re-run) the PROFILE for this project. Copies only the selected core profile — not
 *  every shipped one (`INDEX.md` and the other three cores stay shipped-only, read on demand when matching, never
 *  copied per-project) — and no-ops for a custom/tailored name with no shipped counterpart (e.g. a drafted profile
 *  like `blitzpi`), which still marks the project adopted without touching that file. Edited files are kept and reported. */
export function adoptGoodBehavior(cwd: string, profileName = "development"): AdoptResult {
  const shippedFile = path.join(shippedProfilesDir(), `${profileName}.md`);
  const pairs = fs.existsSync(shippedFile) ? [{ src: shippedFile, rel: path.join(".blitz", "goodbehavior", "profiles", `${profileName}.md`) }] : [];
  const res = syncManagedFiles(pairs, cwd, manifestPath(cwd), blitzVersion());

  const memDir = path.join(cwd, ".blitz", "goodbehavior", "memory");
  fs.mkdirSync(memDir, { recursive: true });
  const memIndex = path.join(memDir, "MEMORY.md");
  if (!fs.existsSync(memIndex)) fs.writeFileSync(memIndex, "# Project Memory\n\nDurable learnings for this project — one fact per file, linked here.\n");
  return res;
}

/** Remove the profile from the project. Memory is kept unless `purgeMemory`. Skills sync separately (syncSkills) — nothing to remove here. */
export function unadoptGoodBehavior(cwd: string, purgeMemory = false): string[] {
  const removed: string[] = [];
  const gb = path.join(cwd, ".blitz", "goodbehavior");
  for (const sub of ["profiles", "manifest.json"]) {
    const p = path.join(gb, sub);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(path.join(".blitz", "goodbehavior", sub)); }
  }
  if (purgeMemory && fs.existsSync(path.join(gb, "memory"))) { fs.rmSync(path.join(gb, "memory"), { recursive: true, force: true }); removed.push(".blitz/goodbehavior/memory"); }
  try { if (fs.existsSync(gb) && fs.readdirSync(gb).length === 0) fs.rmdirSync(gb); } catch { /* keep */ }
  return removed;
}

const skillsManifestPath = (cwd: string) => path.join(cwd, ".blitz", "goodbehavior", "skills-manifest.json");

/**
 * Has this folder actually been set up as a BlitzPi project — i.e. did the user consent?
 *
 * NOT `.blitz/` existence: that directory is BlitzPi's own artefact, and `syncSkills()` used to create it at
 * extension-setup time before anyone was asked, which silently defeated `workspace-init`'s first-run gate — the
 * trust question stopped firing entirely in 1.2.120/1.2.121 (roadmap ONBOARDING-SETUP S0). The honest marker is
 * `blitz.config.yaml`, which only the consented setup path writes.
 */
export function isProjectSetUp(cwd: string): boolean {
  const blitz = path.join(cwd, ".blitz");
  if (!fs.existsSync(blitz)) return false;
  if (fs.existsSync(path.join(blitz, "blitz.config.yaml"))) return true;

  // No config, so decide by what is actually in `.blitz/`. A directory containing ONLY the skills manifest is
  // BlitzPi's own pre-consent footprint from 1.2.120/1.2.121 — that folder was never consented to, so ask.
  // Anything else (profiles, memory, an older adopted layout, even an empty `.blitz/`) predates this fix and
  // belongs to a real project: never re-interrogate an existing user about a folder they already set up.
  const files: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else files.push(r);
    }
  };
  try { walk(blitz, ""); } catch { return true; } // unreadable: assume set up rather than re-ask
  return !(files.length === 1 && files[0] === "goodbehavior/skills-manifest.json");
}

/**
 * Remove this project's copies of the GoodBehavior skills — they are shipped as **package skills** now
 * (`package.json` → `pi.skills`), loaded from the install directory in every session.
 *
 * This is a migration, not housekeeping. Pi's skill loader is **first-wins**, and its order is
 * user (`~/.pi/agent/skills`) → project (`<cwd>/.pi/skills`) → package: a leftover project copy therefore
 * *shadows* the shipped one permanently, pinning an adopter to whatever version was last synced and logging a
 * name collision. Copies the user edited are deliberately KEPT — a hand-edited skill winning is the right
 * outcome — and reported, so the shadowing is a choice rather than a surprise.
 *
 * Never runs against BlitzPi's own checkout (`cwd === INSTALL_ROOT`), where `.pi/skills/` IS the shipped source.
 */
export function retireProjectSkillCopies(cwd: string): AdoptResult {
  const res: AdoptResult = { installed: [], updated: [], kept: [], removed: [] };
  if (path.resolve(cwd) === path.resolve(INSTALL_ROOT)) return res;
  const manifest = readManifestAt(skillsManifestPath(cwd));
  for (const name of [...GB_SKILLS, ...RETIRED_SKILLS]) {
    const dir = path.join(cwd, ".pi", "skills", name);
    if (!fs.existsSync(dir)) continue;
    // "Ours, untouched" = every file still hashes to what we last wrote. Anything else is the user's now.
    const files = fs.readdirSync(dir).map((f) => path.join(".pi", "skills", name, f));
    const untouched = files.length > 0 && files.every((rel) => {
      const abs = path.join(cwd, rel);
      return manifest.files[rel] !== undefined && fs.existsSync(abs) && sha(abs) === manifest.files[rel];
    });
    if (untouched) { fs.rmSync(dir, { recursive: true, force: true }); res.removed.push(path.join(".pi", "skills", name)); }
    else res.kept.push(path.join(".pi", "skills", name));
  }
  if (res.removed.length) {
    try { fs.rmSync(skillsManifestPath(cwd), { force: true }); } catch { /* best effort */ }
    try { const d = path.join(cwd, ".pi", "skills"); if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* keep */ }
  }
  return res;
}

/** @deprecated Superseded by package skills + {@link retireProjectSkillCopies}. Kept only for the adopt command's
 *  historical manifest handling; do not call for skill delivery. */
export function syncSkills(cwd: string): AdoptResult {
  if (path.resolve(cwd) === path.resolve(INSTALL_ROOT)) return { installed: [], updated: [], kept: [], removed: [] };
  const prev = readManifestAt(skillsManifestPath(cwd)); // read BEFORE syncManagedFiles overwrites it below
  const pairs: { src: string; rel: string }[] = [];
  for (const name of GB_SKILLS) {
    const dir = path.join(shippedSkillsDir(), name);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) pairs.push({ src: path.join(dir, f), rel: path.join(".pi", "skills", name, f) });
  }
  const res = syncManagedFiles(pairs, cwd, skillsManifestPath(cwd), blitzVersion());

  for (const name of RETIRED_SKILLS) {
    const dir = path.join(cwd, ".pi", "skills", name);
    if (!fs.existsSync(dir)) continue;
    const rel = path.join(".pi", "skills", name, "SKILL.md");
    const file = path.join(cwd, rel);
    const untouched = prev.files[rel] !== undefined && fs.existsSync(file) && sha(file) === prev.files[rel];
    if (untouched) { fs.rmSync(dir, { recursive: true, force: true }); res.removed.push(rel); } else res.kept.push(rel);
  }
  return res;
}

export interface Profile { name: string; path: string; body: string; frontmatter: Record<string, unknown> }

/** The invariant doctrine — always the shipped copy, never per-project (unlike a profile, it is never copied into
 *  `.blitz/goodbehavior/`, so there is nothing to keep in sync across every adopted project). `null` if missing. */
export function loadDoctrine(): string | null {
  const file = shippedDoctrinePath();
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf-8").trim();
}

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
