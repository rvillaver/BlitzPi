/**
 * Permission ladder for an action on a zone. See docs/SECURITY-ZONES.md.
 *   silent       — no prompt
 *   ask          — prompt: Yes / No / Always-session / Always
 *   ask-noalways — prompt: Yes / No   (project security config; can't be blanket-approved)
 *   dangerous    — red warning; prompt Yes / No; still permittable (interactive only)
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Zone } from "./zones";

export type Level = "silent" | "ask" | "ask-noalways" | "dangerous";
export const severity = (l: Level): number => ({ silent: 0, ask: 1, "ask-noalways": 2, dangerous: 3 }[l]);
export type Action = "read" | "write";

export function decide(action: Action, zone: Zone): Level {
  if (action === "read") {
    switch (zone) {
      case "project": case "goodbehavior": case "project-config": case "plumbing": return "silent";
      default: return "ask"; // system / install / global / other — reading outside the project asks
    }
  }
  // write
  switch (zone) {
    case "plumbing": return "silent";        // writing /dev/null is fine
    case "project": case "goodbehavior": return "ask";
    case "project-config": return "ask-noalways";
    default: return "dangerous";             // install / global / system / other
  }
}

const PROJECT_MARKERS = [".git", ".blitz", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
const under = (p: string, root: string) => p === root || p.startsWith(root + path.sep);

/**
 * The directory an "Always" answer covers for an out-of-project path: the nearest enclosing project (marker file),
 * else the path's own directory. `null` = too broad to remember — `/`, the home directory or any ancestor of it, or
 * a top-level directory like /Users or /tmp — so those ask every time.
 */
export function rememberRoot(target: string, home: string = os.homedir()): string | null {
  const abs = path.resolve(target);
  let start = abs;
  try { if (!fs.statSync(abs).isDirectory()) start = path.dirname(abs); } catch { start = path.dirname(abs); }
  let root = start;
  for (let dir = start; dir !== path.dirname(dir) && !under(home, dir); dir = path.dirname(dir)) {
    if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) { root = dir; break; }
  }
  if (root === path.dirname(root) || under(home, root) || path.dirname(root) === path.dirname(path.dirname(root))) return null;
  return root;
}

/** Memory key for an (action, zone, target): zone-wide except for `other`, which is remembered per directory root. */
export function permissionKey(action: Action, zone: Zone, target: string, home?: string): string | null {
  if (zone !== "other") return `${action}:${zone}`;
  const root = rememberRoot(target, home);
  return root ? `${action}:${zone}:${root}` : null;
}

/** Remembered approvals: in-memory for the session; a JSON file for persistent "Always". */
export class PermissionMemory {
  private session = new Set<string>();
  constructor(private storeFile: string) {}

  private load(): Record<string, boolean> {
    try { return JSON.parse(fs.readFileSync(this.storeFile, "utf-8")); } catch { return {}; }
  }
  isAllowed(key: string): boolean {
    return this.session.has(key) || this.load()[key] === true;
  }
  /** Is this (action, zone, target) covered by a remembered approval? For `other`, only a per-root key covers it —
   *  a legacy zone-wide `read:other` (which unlocked the whole disk) is deliberately ignored. */
  isAllowedFor(action: Action, zone: Zone, target: string): boolean {
    if (zone !== "other") return this.isAllowed(`${action}:${zone}`);
    const abs = path.resolve(target);
    const prefix = `${action}:${zone}:`;
    const keys = [...this.session, ...Object.entries(this.load()).filter(([, v]) => v === true).map(([k]) => k)];
    return keys.some((k) => k.startsWith(prefix) && under(abs, k.slice(prefix.length)));
  }
  rememberSession(key: string): void { this.session.add(key); }
  rememberAlways(key: string): void {
    const cur = this.load(); cur[key] = true;
    fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
    fs.writeFileSync(this.storeFile, JSON.stringify(cur, null, 2));
  }
}

export function defaultPermissionStore(projectRoot: string): string {
  // persistent approvals live with the project (its own policy)
  return path.join(projectRoot, ".blitz", "permissions.json");
}
export const globalDir = () => path.join(process.env.HOME || os.homedir(), ".blitz");
