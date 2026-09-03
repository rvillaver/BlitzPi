/**
 * `blitzpi level` / `/blitz-level` — read and set `security_level` in a project's or the global
 * `.blitz/blitz.config.yaml`. A small text patch, not a full YAML round-trip: these files are hand-authored
 * with comments (see the project's own .blitz/blitz.config.yaml), and a parse-then-reserialize would strip them.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import type { SecurityLevel } from "./permissions";
import type { AuditLogger } from "./audit";
import { realHome } from "./real-home";

export const LEVELS: SecurityLevel[] = ["strict", "guarded", "monitored"];
export const LEVEL_BLURB: Record<SecurityLevel, string> = {
  strict: "asks before every project write, every read outside the project, and every package install — even a clean one",
  guarded: "the default — asks before a project write or a read outside the project; a clean package install proceeds silently",
  monitored: "project writes and reads outside the project proceed silently (still fully audited) — once you trust the agent's judgment",
};
/** True regardless of level — shown once alongside the choices, not repeated in each blurb above. */
export const LEVEL_CONSTANT_NOTE = "In every tier: writing outside the project, and any genuinely dangerous command, always asks.";

export function projectConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".blitz", "blitz.config.yaml");
}
export function globalConfigPath(): string {
  return path.join(realHome(), ".blitz", "blitz.config.yaml");
}

function readLevel(file: string): SecurityLevel | undefined {
  if (!fs.existsSync(file)) return undefined;
  const m = /^security_level:\s*(\S+)/m.exec(fs.readFileSync(file, "utf-8"));
  return m && (LEVELS as string[]).includes(m[1]) ? (m[1] as SecurityLevel) : undefined;
}

/** Where the active tier actually comes from: the project file, the global file, or the built-in default —
 *  mirrors the same project-overrides-global precedence loadConfig() applies to every other field. */
export function describeSecurityLevel(cwd: string = process.cwd()): { level: SecurityLevel; source: "project" | "global" | "default" } {
  const projectLevel = readLevel(projectConfigPath(cwd));
  if (projectLevel) return { level: projectLevel, source: "project" };
  const globalLevel = readLevel(globalConfigPath());
  if (globalLevel) return { level: globalLevel, source: "global" };
  return { level: loadConfig().security_level, source: "default" };
}

function patchLevel(filePath: string, level: SecurityLevel): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const line = `security_level: ${level}`;
  fs.writeFileSync(filePath, /^security_level:.*$/m.test(content) ? content.replace(/^security_level:.*$/m, line) : content ? `${line}\n${content}` : `${line}\n`);
}

/** Sets the tier at project scope by default (the ordinary case: a choice for the project the user is in),
 *  or global scope with `opts.global` (a machine-wide default other projects inherit — see loadConfig()). */
export function setSecurityLevel(level: SecurityLevel, opts: { global?: boolean; cwd?: string; via?: "command" | "onboarding" } = {}, audit?: AuditLogger): { from: SecurityLevel; file: string } {
  const before = describeSecurityLevel(opts.cwd);
  const file = opts.global ? globalConfigPath() : projectConfigPath(opts.cwd);
  patchLevel(file, level);
  audit?.log({ type: "security_level", from: before.level, to: level, scope: opts.global ? "global" : "project", via: opts.via ?? "command" });
  return { from: before.level, file };
}
