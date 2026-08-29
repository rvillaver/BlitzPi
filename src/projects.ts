/**
 * The projects BlitzPi manages — `~/.blitz/projects.json`. A project is registered when it is set up
 * (workspace-init) and touched on every session start, so housekeeping (`blitzpi projects`, `blitzpi report`)
 * has a canonical list instead of scraping the audit trail. Global, per user; nothing project-side.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectRecord {
  first_seen: string;
  last_seen: string;
  sessions: number;
  blitzpi_version?: string;
  profile?: string; // GoodBehavior profile in use
}
export interface ProjectRegistry { version: 1; projects: Record<string, ProjectRecord> }

export interface ProjectStatus extends ProjectRecord {
  path: string;
  exists: boolean; // directory still there
  adopted: boolean; // has .blitz/
  goodbehavior: boolean; // has .blitz/goodbehavior/
}

export const registryPath = (home = process.env.HOME || os.homedir()) => path.join(home, ".blitz", "projects.json");

export function loadRegistry(file = registryPath()): ProjectRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (parsed && parsed.version === 1 && parsed.projects && typeof parsed.projects === "object") return parsed;
  } catch { /* missing or corrupt → fresh */ }
  return { version: 1, projects: {} };
}

function save(reg: ProjectRegistry, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Register or bump a project. `session: true` counts a session start. */
export function touchProject(projectPath: string, info: { version?: string; profile?: string; session?: boolean } = {}, file = registryPath()): ProjectRecord {
  const reg = loadRegistry(file);
  const key = path.resolve(projectPath);
  const now = new Date().toISOString();
  const rec: ProjectRecord = reg.projects[key] ?? { first_seen: now, last_seen: now, sessions: 0 };
  rec.last_seen = now;
  if (info.session) rec.sessions += 1;
  if (info.version) rec.blitzpi_version = info.version;
  if (info.profile) rec.profile = info.profile;
  reg.projects[key] = rec;
  save(reg, file);
  return rec;
}

export function listProjects(file = registryPath()): ProjectStatus[] {
  const reg = loadRegistry(file);
  return Object.entries(reg.projects)
    .map(([p, rec]) => ({
      path: p,
      ...rec,
      exists: fs.existsSync(p),
      adopted: fs.existsSync(path.join(p, ".blitz")),
      goodbehavior: fs.existsSync(path.join(p, ".blitz", "goodbehavior")),
    }))
    .sort((a, b) => (a.last_seen < b.last_seen ? 1 : -1));
}

/** Drop projects whose directory is gone or that no longer carry `.blitz/`. Returns what was removed. */
export function pruneProjects(file = registryPath()): ProjectStatus[] {
  const all = listProjects(file);
  const gone = all.filter((p) => !p.exists || !p.adopted);
  if (gone.length) {
    const reg = loadRegistry(file);
    for (const g of gone) delete reg.projects[g.path];
    save(reg, file);
  }
  return gone;
}

export function forgetProject(projectPath: string, file = registryPath()): boolean {
  const reg = loadRegistry(file);
  const key = path.resolve(projectPath);
  if (!(key in reg.projects)) return false;
  delete reg.projects[key];
  save(reg, file);
  return true;
}

export function isRegistered(projectPath: string, file = registryPath()): boolean {
  return path.resolve(projectPath) in loadRegistry(file).projects;
}

export function renderProjects(list: ProjectStatus[]): string {
  if (!list.length) return "No projects registered. A project is registered when BlitzPi sets it up (first run in a folder).";
  const rows = list.map((p) => {
    const state = !p.exists ? "missing" : !p.adopted ? "no .blitz" : p.goodbehavior ? "ok +goodbehavior" : "ok";
    return `  ${p.last_seen.slice(0, 10)}  ${String(p.sessions).padStart(4)} sessions  ${state.padEnd(16)} ${p.path}${p.profile ? `  (${p.profile})` : ""}`;
  });
  return ["Projects managed by BlitzPi (most recent first):", ...rows, "", "  blitzpi projects prune   removes entries that are missing or no longer carry .blitz/"].join("\n");
}
