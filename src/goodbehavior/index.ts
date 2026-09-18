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
import { loadConfig, type BlitzConfig } from "../config";
import { adoptGoodBehavior, isAdopted, isProfileChosen, isProjectSetUp, loadDoctrine, loadProfile, retireProjectSkillCopies, shippedProfilesDir, unadoptGoodBehavior } from "../adopt-goodbehavior";
import { createDoneGate, DoneGate, type ToolCall } from "./done-gate";
import { stripInstallDocs } from "../prompt-hygiene";
import { info } from "../log";
import { askSelect } from "../ui-ask";

export interface GoodBehaviorContext {
  doneGate: DoneGate;
  toolsCalled: ToolCall[];
  /** The run in progress is the gate's own continuation — don't re-fire on it (the Stop hook's `stop_hook_active`). */
  continuing?: boolean;
}
let gbContext: GoodBehaviorContext | null = null;

/**
 * Build the done-gate from a profile's `done_gate` front-matter. Separate from setup so a profile drafted or
 * switched mid-session can rebuild it (UX-6) instead of being frozen at whatever was active at startup.
 *
 * Carries `toolsCalled` across the rebuild: the accumulated tool calls belong to the turn, not to the gate, so
 * swapping the gate must never lose the evidence an in-flight check would be judged on.
 */
function buildGateFor(cwd: string, profileName: string): void {
  const gateCfg = (loadProfile(cwd, profileName)?.frontmatter?.done_gate ?? {}) as {
    build_tools?: string[]; observe_tools?: string[]; verify_hint?: string; mutate_tools?: string[];
  };
  gbContext = {
    doneGate: createDoneGate(gateCfg.build_tools, gateCfg.observe_tools, gateCfg.verify_hint, gateCfg.mutate_tools),
    toolsCalled: gbContext?.toolsCalled ?? [],
    continuing: gbContext?.continuing,
  };
}

/** The configured profile, re-read from disk. `loadConfig()` re-layers global + project, so a mid-session edit to
 *  either `.blitz/blitz.config.yaml` is picked up. Falls back to the shipped default if the config is unreadable. */
function resolveProfileName(current: string): string {
  try { return loadConfig().goodbehavior?.profile ?? "development"; }
  catch { return current; } // keep what is in force: a transient read error must not silently downgrade
}

/**
 * Where the SHIPPED core profiles live, as an absolute path resolved at runtime.
 *
 * Injected because the alternative is making the model do path arithmetic. The drafting skill used to say
 * `.pi/goodbehavior/profiles/INDEX.md`, which resolves against the *project* and fails with ENOENT (seen live in a
 * user's session); rewriting it as `../../goodbehavior/profiles/` merely swapped that for hardcoded directory-depth
 * arithmetic relative to the skill's own location — still a guess, and still brittle if the layout moves. These
 * files ship with the install, so the install is the only thing that can say where they are.
 */
export function goodBehaviorPathsPrompt(): string {
  return `\n\n<goodbehavior-paths shipped-profiles="${shippedProfilesDir()}">\nThe four core GoodBehavior profiles live in the directory above — an absolute path, already resolved for this install. Read them from there; do not guess a relative path, and do not look for them under the project's own .pi/ (they are not copied into projects).\n</goodbehavior-paths>`;
}

export function profilePrompt(cwd: string, profileName: string): string | null {
  if (!isAdopted(cwd)) return null;
  const profile = loadProfile(cwd, profileName);
  if (!profile) return null;
  const doctrine = loadDoctrine();
  const doctrineBlock = doctrine ? `\n\n<goodbehavior-doctrine>\n${doctrine}\n</goodbehavior-doctrine>` : "";
  return `${doctrineBlock}\n\n<goodbehavior profile="${profile.name}">\n${profile.body}\n</goodbehavior>`;
}

export function setupGoodBehavior(pi: ExtensionAPI, config: BlitzConfig): void {
  const cwd = process.cwd();
  // Skills are package skills now (package.json → pi.skills): the install serves them in every session, so
  // nothing is copied into the user's folder and nothing is written before consent (ONBOARDING-SETUP S0/S4a).
  // What remains is the one-time migration for projects adopted before this — their copies would otherwise
  // shadow the shipped ones (Pi's loader is first-wins, project before package). Only in a consented project.
  if (isProjectSetUp(cwd)) {
    try {
      const r = retireProjectSkillCopies(cwd);
      if (r.removed.length) info(`[Blitz:GoodBehavior] ${r.removed.length} project skill copies retired — GoodBehavior skills now ship with BlitzPi itself`);
      if (r.kept.length) info(`[Blitz:GoodBehavior] kept your edited skill copies (they take precedence over the shipped ones): ${r.kept.join(", ")}`);
    } catch { /* best effort */ }
  }
  // `profileName` is the *currently resolved* profile, not a startup constant — before_agent_start re-resolves it
  // every turn so a profile drafted mid-session activates without a restart (UX-5).
  let profileName = config.goodbehavior?.profile ?? "development";
  buildGateFor(cwd, profileName);
  const adopted = isAdopted(cwd);
  const profile = adopted ? loadProfile(cwd, profileName) : null;
  const profilePath = adopted && profile ? ` → ${profile.path}` : "";
  info(`[Blitz:GoodBehavior] ${adopted ? `adopted — profile "${profileName}"${profilePath}` : "not adopted in this project (/adopt-goodbehavior)"}`);

  // The generic shipped profile isn't written for this project. Nudge every interactive session until someone
  // (the agent, via draft-profile-goodbehavior, or a human by hand) points goodbehavior.profile somewhere else —
  // self-terminating: the condition itself is the state, no separate "asked" marker needed.
  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    // Read the state now, not at extension-load time: on a genuinely first run the project is adopted by the
    // setup flow *after* this module loaded, so the captured value was always false (audit 12, G12-9).
    if (!isAdopted(cwd) || profileName !== "development") return;
    // "development" chosen deliberately is an answer, not an absence — do not nag about it (G13-1).
    if (isProfileChosen(cwd)) return;
    pi.sendMessage({
      customType: "blitz-goodbehavior",
      content: "This project's GoodBehavior profile is still the generic shipped default — draft a project-specific GoodBehavior profile for it.",
      display: true,
    });
  });

  pi.on("before_agent_start", async (event: any, ctx: ExtensionContext) => {
    // Re-resolve which profile is active, every turn. Drafting a profile writes the file AND points
    // goodbehavior.profile at it; before this, only the profile *body* hot-reloaded, so the new profile sat
    // inert until a restart. This hook fires after the user submits but before the agent loop, and the gate is
    // evaluated at agent_end — so swapping here is always between turns, never during an in-flight check (UX-6).
    const resolved = resolveProfileName(profileName);
    if (resolved !== profileName) {
      const previous = profileName;
      profileName = resolved;
      buildGateFor(cwd, profileName);
      const note = `[Blitz:GoodBehavior] profile "${previous}" → "${profileName}" (picked up without restart)`;
      info(note);
      if (ctx?.hasUI) ctx.ui.notify(`GoodBehavior: now using the "${profileName}" profile.`, "info");
    }
    const base = stripInstallDocs(event.systemPrompt ?? "");
    const extra = profilePrompt(cwd, profileName) ?? "";
    // Paths go in unconditionally — the drafting skill runs in projects that have no profile yet, so gating this
    // on adoption (as profilePrompt is) would withhold it from exactly the case that needs it.
    return { systemPrompt: `${base}${goodBehaviorPathsPrompt()}${extra}` };
  });

  pi.on("tool_call", (event: ToolCallEvent) => {
    gbContext?.toolsCalled.push({ name: (event as any).toolName || (event as any).tool || "unknown", input: (event as any).input });
  });

  // A human prompt starts a fresh turn: whatever the gate was continuing is over.
  pi.on("input", () => { if (gbContext) gbContext.continuing = false; });

  pi.on("agent_end", (event: any, ctx: ExtensionContext) => {
    if (!gbContext) return;
    // Judge the LAST thing the agent said, as the Stop hook does — not every message of the run joined together.
    const texts = (event.messages ?? [])
      .filter((m: any) => m.role === "assistant")
      .map((m: any) => (Array.isArray(m.content) ? m.content : []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join(" "))
      .filter((t: string) => t.trim());
    const tools = gbContext.toolsCalled;
    gbContext.toolsCalled = [];
    // One fire per turn: the continuation this gate queued must not be gated again, or a stubborn claim loops.
    if (gbContext.continuing) { gbContext.continuing = false; return; }
    const verdict = gbContext.doneGate.check(texts[texts.length - 1] ?? "", tools);
    if (!verdict.blocked) return;
    // The feedback goes to the MODEL, not only to a toast (FC-10): Pi runs a message queued from an agent_end handler
    // as a continuation of the same run, so this works headless (`-p`, `--mode rpc`, the bridge) as well as in the TUI.
    gbContext.continuing = true;
    const feedback = verdict.feedback ?? verdict.reason ?? "completion claimed without verification this turn.";
    info(`[Blitz:GoodBehavior] done-gate fired: ${verdict.reason}`);
    if (ctx.hasUI) ctx.ui.notify(`GoodBehavior: ${verdict.reason}`, "warning");
    pi.sendMessage({ customType: "goodbehavior-done-gate", content: feedback, display: true }, { deliverAs: "followUp", triggerTurn: true });
  });

  pi.registerCommand("adopt-goodbehavior", {
    description: "Adopt GoodBehavior's profile into this project (or update it): files you edited are kept. Profile only — the skills ship with BlitzPi and are always active, nothing to adopt.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const first = !isAdopted(cwd);
      const r = adoptGoodBehavior(cwd, profileName);
      const lines = [
        `GoodBehavior profile ${first ? "adopted into" : "updated in"} ${cwd}`,
        `- installed: ${r.installed.length}  updated: ${r.updated.length}  kept (edited by you): ${r.kept.length}`,
        ...r.kept.map((f) => `  kept: ${f}`),
        ...r.updated.map((f) => `  updated: ${f}`),
        `- doctrine: .blitz/goodbehavior/profiles/${profileName}.md (injected into every turn); memory: .blitz/goodbehavior/memory/`,
      ];
      if (profileName === "development") lines.push("This project doesn't have a tailored profile yet — it's still the generic shipped default. Draft a project-specific GoodBehavior profile for it.");
      const content = lines.join("\n");
      if (ctx.hasUI) pi.sendMessage({ customType: "blitz-goodbehavior", content, display: true }); else info(content);
    },
  });

  pi.registerCommand("unadopt-goodbehavior", {
    description: "Remove GoodBehavior's profile from this project (project memory kept unless you say so). Skills are unaffected — they ship with BlitzPi, not with the project.",
    handler: async (args: string, ctx: ExtensionContext) => {
      if (!isAdopted(cwd)) { ctx.ui.notify("GoodBehavior is not adopted in this project.", "info"); return; }
      let purge = /--purge|--memory/.test(args ?? "");
      if (ctx.hasUI) {
        const c = await askSelect(ctx, `Remove GoodBehavior from ${cwd}?`, ["Yes — keep project memory", "Yes — also delete .blitz/goodbehavior/memory", "No"]);
        if (!c || c === "No") return;
        purge = c.includes("delete");
      }
      const removed = unadoptGoodBehavior(cwd, purge);
      const content = `GoodBehavior profile removed from ${cwd}\n${removed.map((f) => `- ${f}`).join("\n")}\n${purge ? "" : "- project memory kept: .blitz/goodbehavior/memory/\n"}This project now runs on the generic default profile again. Skills are unaffected — they ship with BlitzPi.`;
      if (ctx.hasUI) pi.sendMessage({ customType: "blitz-goodbehavior", content, display: true }); else info(content);
    },
  });
}

export function getGoodBehaviorContext(): GoodBehaviorContext | null { return gbContext; }
