/**
 * Runtime permission gate — resolves an action on a path/command into allow/block, prompting the user
 * per the ladder (see docs/SECURITY-ZONES.md). Used by both the bash tool and the file tools.
 * Non-interactive runs: silent/ask auto-allow; dangerous is refused (no human to warn).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classifyZone, type Zone, type ZoneRoots } from "./zones";
import { decide, severity, permissionKey, type Action, type Level, type SecurityLevel, PermissionMemory } from "./permissions";
import type { CmdTarget } from "./bash-guard";
import type { AuditLogger } from "./audit";
import { redactCommand } from "./feeds/secrets";
import type { Grant } from "./sandbox-backends";
import { isAbsolute, resolve } from "node:path";

/** Confined zones never need a grant: the backend already opens them. */
const CONFINED_ZONES = new Set<Zone>(["project", "goodbehavior", "project-config", "plumbing", "scratch"]);
/** The out-of-workspace paths a command names, as grants for the backend (absolute; write wins over read). */
export function grantsFor(targets: CmdTarget[], roots: ZoneRoots): Grant[] {
  const out = new Map<string, boolean>();
  for (const t of targets) {
    if (CONFINED_ZONES.has(classifyZone(t.path, roots))) continue;
    if (t.path.startsWith("~")) continue; // HOME is pinned to the workspace inside the sandbox
    const abs = isAbsolute(t.path) ? resolve(t.path) : resolve(roots.project, t.path);
    out.set(abs, (out.get(abs) ?? false) || t.write);
  }
  return [...out.entries()].map(([path, write]) => ({ path, write }));
}

export interface GateResult { allow: boolean; reason: string; zone: Zone; level: Level; confined: boolean; }

export class PermissionGate {
  constructor(readonly roots: ZoneRoots, private memory: PermissionMemory, private audit: AuditLogger, private level: SecurityLevel = "guarded") {}

  /** Most severe (action, zone, target) among a command's named paths — used to pick which target `resolve()`
   *  is then asked about; the tier only shifts relative severity among ask/silent levels, never which target is
   *  most severe (a dangerous write outside the project always outranks everything, in every tier). */
  worst(targets: CmdTarget[], command: string): { action: Action; zone: Zone; target: string; level: Level } {
    let w = { action: "read" as Action, zone: "project" as Zone, target: command, level: "silent" as Level };
    for (const t of targets) {
      const action: Action = t.write ? "write" : "read";
      const zone = classifyZone(t.path, this.roots);
      const level = decide(action, zone, this.level);
      if (severity(level) > severity(w.level)) w = { action, zone, target: t.path, level };
    }
    return w;
  }

  /** Resolve a single path action by classifying its zone. */
  async resolvePath(action: Action, target: string, label: string, ctx: ExtensionContext | undefined): Promise<GateResult> {
    return this.resolve(action, classifyZone(target, this.roots), target, label, ctx);
  }

  /** Treat a whole command as a dangerous out-of-project action (for shell-shape dangers like sudo). */
  async resolveDangerousCommand(command: string, why: string, ctx: ExtensionContext | undefined): Promise<GateResult> {
    return this.resolve("write", "other", `${why} — runs unsandboxed if allowed: ${command}`, "bash command", ctx);
  }

  /** Core resolver. `confined` = the action stays inside the project. `context` (bash calls only): the full
   *  command a bare extracted target like `/` came from — e.g. `find / -iname …` — so the prompt explains
   *  itself instead of showing an unexplained root-looking path. File-tool asks never pass this; their target
   *  already is the whole story. */
  async resolve(action: Action, zone: Zone, target: string, label: string, ctx: ExtensionContext | undefined, context?: string): Promise<GateResult> {
    const interactive = !!ctx?.hasUI;
    // A looser tier (`monitored`) trades prompts for trust in an interactive session; an unattended run has no
    // human to extend that trust to, so it always gets the shipped, verified `guarded` ladder regardless of the
    // project's chosen tier.
    const level = decide(action, zone, interactive ? this.level : "guarded");
    const confined = zone === "project" || zone === "goodbehavior" || zone === "project-config" || zone === "plumbing" || zone === "scratch";
    // Zone-wide memory, except `other`: remembered per directory root (one "Always" must not unlock the whole disk).
    const key = permissionKey(action, zone, target, this.roots.home);
    const base = { zone, level, confined };

    if (level === "silent") return { allow: true, reason: "in-scope", ...base };
    if (this.memory.isAllowedFor(action, zone, target)) return { allow: true, reason: "remembered", ...base };

    if (!interactive) {
      const allow = level !== "dangerous";
      this.log(action, zone, target, allow, interactive ? "prompt" : "auto", label);
      return { allow, reason: allow ? "auto-approved (non-interactive)" : "dangerous, refused (non-interactive)", ...base };
    }

    // The ask leads with the thing itself: action + target. Mechanics (zones, memory scope) stay out of the
    // prompt — the "Always" options carry their own scope, and the audit trail holds the rest. `why` is a
    // secondary, parenthetical annotation — the target stays the first thing read, matching "lead with the
    // thing being approved" — shown only when the command actually differs from the bare target (a bash-command
    // whose extracted target like `/` doesn't explain itself: `find / -iname …`).
    const what = redactCommand(String(target)).replace(/\s+/g, " ").slice(0, 160);
    const why = context && context.trim() !== target.trim() ? `  (${redactCommand(context).replace(/\s+/g, " ").slice(0, 100)})` : "";
    let choice: string | undefined;
    if (level === "dangerous") {
      choice = await ctx!.ui.select(`⚠ Allow DANGEROUS ${action}? ${what}${why}`, ["No", "Yes (I understand the risk)"]);
      choice = choice?.startsWith("Yes") ? "Yes" : "No";
    } else if (level === "ask-noalways") {
      choice = await ctx!.ui.select(`Allow ${action} to security config? ${what}${why}`, ["No", "Yes"]);
    } else if (!key) {
      choice = await ctx!.ui.select(`Allow ${action}? ${what}${why}`, ["Yes", "No"]);
    } else {
      const scope = zone === "other" ? ` for ${key.slice(`${action}:${zone}:`.length)}` : "";
      choice = await ctx!.ui.select(`Allow ${action}? ${what}${why}`, ["Yes", "No", `Always this session${scope}`, `Always${scope}`]);
    }

    let allow = false;
    if (choice === "Yes") allow = true;
    else if (choice?.startsWith("Always this session")) { allow = true; if (key) this.memory.rememberSession(key); }
    else if (choice?.startsWith("Always")) { allow = true; if (key) this.memory.rememberAlways(key); }
    this.log(action, zone, target, allow, "prompt", label);
    return { allow, reason: allow ? `approved (${choice})` : "declined", ...base };
  }

  private log(action: Action, zone: Zone, target: string, allowed: boolean, via: string, tool?: string): void {
    this.audit.log({ type: "permission_check", action, zone, target: redactCommand(String(target)).slice(0, 300), allowed, via, tool });
  }
}
