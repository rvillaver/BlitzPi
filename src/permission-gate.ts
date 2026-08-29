/**
 * Runtime permission gate — resolves an action on a path/command into allow/block, prompting the user
 * per the ladder (see docs/SECURITY-ZONES.md). Used by both the bash tool and the file tools.
 * Non-interactive runs: silent/ask auto-allow; dangerous is refused (no human to warn).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { classifyZone, type Zone, type ZoneRoots } from "./zones";
import { decide, severity, permissionKey, type Action, type Level, PermissionMemory } from "./permissions";
import type { CmdTarget } from "./bash-guard";
import type { AuditLogger } from "./audit";

export interface GateResult { allow: boolean; reason: string; zone: Zone; level: Level; confined: boolean; }

export class PermissionGate {
  constructor(private roots: ZoneRoots, private memory: PermissionMemory, private audit: AuditLogger) {}

  /** Most severe (action, zone, target) among a command's named paths. */
  worst(targets: CmdTarget[], command: string): { action: Action; zone: Zone; target: string; level: Level } {
    let w = { action: "read" as Action, zone: "project" as Zone, target: command, level: "silent" as Level };
    for (const t of targets) {
      const action: Action = t.write ? "write" : "read";
      const zone = classifyZone(t.path, this.roots);
      const level = decide(action, zone);
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
    return this.resolve("write", "other", `${why}: ${command}`, "bash command", ctx);
  }

  /** Core resolver. `confined` = the action stays inside the project. */
  async resolve(action: Action, zone: Zone, target: string, label: string, ctx: ExtensionContext | undefined): Promise<GateResult> {
    const level = decide(action, zone);
    const confined = zone === "project" || zone === "goodbehavior" || zone === "project-config" || zone === "plumbing";
    // Zone-wide memory, except `other`: remembered per directory root (one "Always" must not unlock the whole disk).
    const key = permissionKey(action, zone, target, this.roots.home);
    const base = { zone, level, confined };

    if (level === "silent") return { allow: true, reason: "in-scope", ...base };
    if (this.memory.isAllowedFor(action, zone, target)) return { allow: true, reason: "remembered", ...base };

    const interactive = !!ctx?.hasUI;
    if (!interactive) {
      const allow = level !== "dangerous";
      this.log(action, zone, target, allow, interactive ? "prompt" : "auto");
      return { allow, reason: allow ? "auto-approved (non-interactive)" : "dangerous, refused (non-interactive)", ...base };
    }

    const q = `${action === "write" ? "Write" : "Read"} ${label}\n  ${target}\n  zone: ${zone}`;
    let choice: string | undefined;
    if (level === "dangerous") {
      ctx!.ui.notify(`DANGEROUS: ${action} outside your project (${zone}). ${target}`, "error");
      choice = await ctx!.ui.select(`⚠ BlitzPi: allow DANGEROUS ${action}?`, ["No", "Yes (I understand the risk)"]);
      choice = choice?.startsWith("Yes") ? "Yes" : "No";
    } else if (level === "ask-noalways") {
      choice = await ctx!.ui.select(`BlitzPi: allow ${action} to project security config?`, ["No", "Yes"]);
    } else if (!key) {
      choice = await ctx!.ui.select(`BlitzPi: allow this ${action}? (${zone} — too broad to remember; asks every time)`, ["Yes", "No"]);
    } else {
      const scope = zone === "other" ? ` for ${key.slice(`${action}:${zone}:`.length)}` : "";
      choice = await ctx!.ui.select(`BlitzPi: allow this ${action}? (${zone})`, ["Yes", "No", `Always this session${scope}`, `Always${scope}`]);
    }

    let allow = false;
    if (choice === "Yes") allow = true;
    else if (choice?.startsWith("Always this session")) { allow = true; if (key) this.memory.rememberSession(key); }
    else if (choice?.startsWith("Always")) { allow = true; if (key) this.memory.rememberAlways(key); }
    this.log(action, zone, target, allow, "prompt");
    return { allow, reason: allow ? `approved (${choice})` : "declined", ...base };
  }

  private log(action: Action, zone: Zone, target: string, allowed: boolean, via: string): void {
    this.audit.log({ type: "permission_check", action, zone, target: String(target).slice(0, 300), allowed, via });
  }
}
