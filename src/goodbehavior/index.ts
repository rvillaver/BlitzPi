/**
 * GoodBehavior for BlitzPi — the profile is the doctrine.
 *
 * - Injects the active profile (`.blitz/goodbehavior/profiles/<name>.md`) into the system prompt, ONLY in projects
 *   that adopted GoodBehavior. Doctrine only: how work gets done. Security is enforced by the runtime hooks, never
 *   by prompt text (a security prompt made the model refuse safe in-workspace work — see project memory).
 * - Done-gate: warns when a turn claims completion without observing the result; which tools count comes from
 *   the profile's `done_gate` front-matter.
 * - Commands: /adopt-goodbehavior (adopt or update), /unadopt-goodbehavior (remove; memory kept unless asked).
 */
import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import type { BlitzConfig } from "../config";
import { adoptGoodBehavior, isAdopted, loadProfile, unadoptGoodBehavior } from "../adopt-goodbehavior";
import { createDoneGate, DoneGate } from "./done-gate";
import { stripInstallDocs } from "../prompt-hygiene";
import { info } from "../log";

export interface GoodBehaviorContext { doneGate: DoneGate; toolsCalled: string[] }
let gbContext: GoodBehaviorContext | null = null;

export function profilePrompt(cwd: string, profileName: string): string | null {
  if (!isAdopted(cwd)) return null;
  const profile = loadProfile(cwd, profileName);
  if (!profile) return null;
  return `\n\n<goodbehavior profile="${profile.name}">\n${profile.body}\n</goodbehavior>`;
}

export function setupGoodBehavior(pi: ExtensionAPI, config: BlitzConfig): void {
  const cwd = process.cwd();
  const profileName = config.goodbehavior?.profile ?? "development";
  const profile = loadProfile(cwd, profileName);
  const gateCfg = (profile?.frontmatter?.done_gate ?? {}) as { build_tools?: string[]; observe_tools?: string[] };
  gbContext = { doneGate: createDoneGate(gateCfg.build_tools, gateCfg.observe_tools), toolsCalled: [] };
  const adopted = isAdopted(cwd);
  info(`[Blitz:GoodBehavior] ${adopted ? `adopted — profile "${profileName}"` : "not adopted in this project (/adopt-goodbehavior)"}`);

  pi.on("before_agent_start", async (event: any) => {
    const base = stripInstallDocs(event.systemPrompt ?? "");
    const extra = profilePrompt(cwd, profileName) ?? "";
    return { systemPrompt: `${base}${extra}` };
  });

  pi.on("tool_call", (event: ToolCallEvent) => {
    gbContext?.toolsCalled.push((event as any).toolName || (event as any).tool || "unknown");
  });

  pi.on("agent_end", (event: any, ctx: ExtensionContext) => {
    if (!gbContext) return;
    const text = (event.messages ?? [])
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c?.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    const verdict = gbContext.doneGate.check(text, gbContext.toolsCalled);
    if (verdict.blocked && ctx.hasUI) ctx.ui.notify(`GoodBehavior: ${verdict.reason ?? "completion claimed without verification this turn."}`, "warning");
    gbContext.toolsCalled = [];
  });

  pi.registerCommand("adopt-goodbehavior", {
    description: "Adopt GoodBehavior into this project (or update it): skills + profile; files you edited are kept",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const first = !isAdopted(cwd);
      const r = adoptGoodBehavior(cwd);
      const lines = [
        `GoodBehavior ${first ? "adopted into" : "updated in"} ${cwd}`,
        `- installed: ${r.installed.length}  updated: ${r.updated.length}  kept (edited by you): ${r.kept.length}  removed (retired): ${r.removed.length}`,
        ...r.kept.map((f) => `  kept: ${f}`),
        ...r.updated.map((f) => `  updated: ${f}`),
        `- doctrine: .blitz/goodbehavior/profiles/${profileName}.md (injected into every turn); memory: .blitz/goodbehavior/memory/`,
      ];
      if (first || r.installed.length) lines.push("ACTION NEEDED: skills load at startup — restart BlitzPi here to activate them.");
      const content = lines.join("\n");
      if (ctx.hasUI) pi.sendMessage({ customType: "blitz-goodbehavior", content, display: true }); else info(content);
    },
  });

  pi.registerCommand("unadopt-goodbehavior", {
    description: "Remove GoodBehavior from this project (skills + profile; project memory kept unless you say so)",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (!isAdopted(cwd)) { ctx.ui.notify("GoodBehavior is not adopted in this project.", "info"); return; }
      let purge = /--purge|--memory/.test(args ?? "");
      if (ctx.hasUI) {
        const c = await ctx.ui.select(`Remove GoodBehavior from ${cwd}?`, ["Yes — keep project memory", "Yes — also delete .blitz/goodbehavior/memory", "No"]);
        if (!c || c === "No") return;
        purge = c.includes("delete");
      }
      const removed = unadoptGoodBehavior(cwd, purge);
      const content = `GoodBehavior removed from ${cwd}\n${removed.map((f) => `- ${f}`).join("\n")}\n${purge ? "" : "- project memory kept: .blitz/goodbehavior/memory/\n"}Restart BlitzPi here to unload the skills.`;
      if (ctx.hasUI) pi.sendMessage({ customType: "blitz-goodbehavior", content, display: true }); else info(content);
    },
  });
}

export function getGoodBehaviorContext(): GoodBehaviorContext | null { return gbContext; }
