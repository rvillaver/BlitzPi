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
