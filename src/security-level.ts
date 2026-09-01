/**
 * `blitzpi level` / `/blitz-level` — read and set `security_level` in a project's or the global
 * `.blitz/blitz.config.yaml`. A small text patch, not a full YAML round-trip: these files are hand-authored
 * with comments (see the project's own .blitz/blitz.config.yaml), and a parse-then-reserialize would strip them.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "./config";
import type { SecurityLevel } from "./permissions";
import type { AuditLogger } from "./audit";

export const LEVELS: SecurityLevel[] = ["strict", "guarded", "monitored"];
export const LEVEL_BLURB: Record<SecurityLevel, string> = {
  strict: "asks more — also before a package install, even a clean one",
  guarded: "today's shipped default — project writes and outside-project reads ask, installs are silent-if-clean",
  monitored: "asks less — project writes and outside-project reads go silent (still audited)",
};

export function projectConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".blitz", "blitz.config.yaml");
}
export function globalConfigPath(): string {
  return path.join(process.env.HOME || os.homedir(), ".blitz", "blitz.config.yaml");
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
