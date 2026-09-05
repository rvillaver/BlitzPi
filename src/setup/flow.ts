/**
 * The five first-run steps, in the user's order. Each one delegates to the module that already owns that
 * question — the flow sequences, it does not re-implement.
 */
import fs from "node:fs";
import path from "node:path";
import type { AuditLogger } from "../audit";
import { isProjectSetUp, loadProfile } from "../adopt-goodbehavior";
import { describeSecurityLevel, setSecurityLevel, LEVELS, LEVEL_BLURB, LEVEL_CONSTANT_NOTE } from "../security-level";
import { FeedStore } from "../feeds/store";
import { capabilities } from "../sandbox-probe";
import { pinnedPythonFor, PYTHON_VERSION } from "../runtimes/pinned";
import { RuntimeStore } from "../runtimes/store";
import type { SetupStep, StepContext, StepOutcome } from "./steps";

const NOT_NOW = "Not now — you can do this later";

/**
 * 0. The introduction (S4b). A dialog, not a chat message: `pi.sendMessage` queues and renders asynchronously, so
 * the first driven run put the welcome AFTER every question the user had already answered. `ui.select` paints in
 * sequence with the other steps, which is the only thing that makes an introduction an introduction.
 */
export function introStep(intro: (cwd: string) => string): SetupStep {
  return {
    id: "intro",
    scope: "project",
    informational: true,
    preview: "(the welcome itself)",
    done: (cwd) => isProjectSetUp(cwd), // an established project is never re-introduced
    current: () => null,
    async run(ctx: StepContext): Promise<StepOutcome> {
      if (!ctx.interactive) return "ok";
      await ctx.ui.select(intro(ctx.cwd), ["Let's set it up"]);
      return "ok";
    },
  };
}

/** 1. Trust the folder. The only step that can abort the flow: declining means "not this folder". */
export function trustStep(setUp: (cwd: string) => void, onDecline: () => void): SetupStep {
  return {
    id: "trust",
    scope: "project",
    preview: "Set this folder up as a BlitzPi project (nothing is written until you agree)",
    done: (cwd) => isProjectSetUp(cwd),
    current: (cwd) => (isProjectSetUp(cwd) ? "set up" : null),
    async run(ctx: StepContext) {
      const hasFiles = fs.readdirSync(ctx.cwd).some((f) => !f.startsWith("."));
      if (!ctx.interactive) return "abort"; // no one to ask: do NOT silently adopt a folder
      const choice = await ctx.ui.select(
        `Set up this folder as your BlitzPi project?\n  ${ctx.cwd}${hasFiles ? "\n  (it already contains files — they become your workspace)" : ""}`,
        ["Yes — trust & set up here", "No — exit"],
      );
      if (!choice || choice.startsWith("No")) { onDecline(); return "abort"; }
      setUp(ctx.cwd);
      return "ok";
    },
  };
}

/** 2. Profile — what this project is, so "done" means something concrete here. */
export function profileStep(configuredProfile: (cwd: string) => string, adopt: (cwd: string, name: string) => void): SetupStep {
  // The four options are the plain-language ones from GOODBEHAVIOR-UX Phase 3; internal names stay internal.
  const OPTIONS: { label: string; hint: string; profile: string }[] = [
    { label: "An app or service", hint: "I check it by running it", profile: "development" },
    { label: "Data or analysis", hint: "I check the numbers against real input", profile: "analysis" },
    { label: "Research or writing", hint: "I check the claims against sources", profile: "research" },
    { label: "Something people read or watch", hint: "I check how it lands with them", profile: "creative" },
  ];
  return {
    id: "profile",
    preview: "What kind of project this is, so \"done\" means something concrete here",
    // "development" is the shipped generic default — present but not actually chosen.
    done: (cwd) => isProjectSetUp(cwd) && configuredProfile(cwd) !== "development",
    current: (cwd) => {
      const n = configuredProfile(cwd);
      return n === "development" ? null : (loadProfile(cwd, n)?.name ?? n);
    },
    async run(ctx: StepContext): Promise<StepOutcome> {
      if (!ctx.interactive) return "later";
      const labels = OPTIONS.map((o) => `${o.label} — ${o.hint}`);
      const choice = await ctx.ui.select(
        "What kind of project is this — and how would you know the work is actually right?",
        [...labels, NOT_NOW],
      );
      if (!choice || choice === NOT_NOW) return "later";
      const picked = OPTIONS[labels.indexOf(choice)];
      if (picked) adopt(ctx.cwd, picked.profile);
      return "ok";
    },
  };
}

/**
 * 3. Runtimes (S4e). Reports what the sandbox can actually reach — from the in-sandbox probe (P1), never the host —
 * and offers to install the pinned Python when it is missing.
 *
 * The size is stated up front and in full. A Python install is ~106 MB down and ~350 MB on disk, roughly 80x the
 * security feeds; borrowing the feeds' "≈ 4.5 MB" register here would mislead by two orders of magnitude.
 */
export function runtimeStep(install?: (ctx: StepContext) => Promise<void>, store = new RuntimeStore()): SetupStep {
  const marker = (cwd: string) => path.join(cwd, ".blitz", ".runtimes-noted");
  return {
    id: "runtimes",
    preview: "Which language runtimes the sandbox can reach (python, node, …)",
    done: (cwd) => fs.existsSync(marker(cwd)),
    current: () => {
      const c = capabilities();
      return c ? `${c.available.join(", ") || "none"}${c.missing.length ? ` (missing: ${c.missing.join(", ")})` : ""}` : null;
    },
    async run(ctx: StepContext): Promise<StepOutcome> {
      const c = capabilities();
      const body = c
        ? `Inside the sandbox this project can use: ${c.available.join(", ") || "none of the tools I check for"}.` +
          (c.missing.length ? `\nNot reachable in there: ${c.missing.join(", ")} — even if they are installed on your machine, the sandbox does not expose them.` : "")
        : "I could not check what the sandbox can reach this time.";
      const note = (cwd: string) => { try { fs.mkdirSync(path.dirname(marker(cwd)), { recursive: true }); fs.writeFileSync(marker(cwd), new Date().toISOString() + "\n"); } catch { /* best effort */ } };
      if (!ctx.interactive) { note(ctx.cwd); return "ok"; }

      const pin = pinnedPythonFor();
      const pythonMissing = !!c && !c.available.includes("python3");
      // Only offer what can actually be delivered: a pinned build for this platform, not already installed.
      const canOffer = pythonMissing && !!pin && !store.installed("python") && !!install;
      if (!canOffer) {
        await ctx.ui.select(body, ["OK, continue"]);
        note(ctx.cwd);
        return "ok";
      }
      const yes = `Yes — download Python ${PYTHON_VERSION} (${(pin!.bytes / 1048576).toFixed(0)} MB download, ~350 MB on disk)`;
      const choice = await ctx.ui.select(
        `${body}\n\nBlitzPi can install its own Python for the sandbox to use. It is downloaded only if you ask, and only the agent's shell sees it — your own PATH is untouched.`,
        [yes, "No — don't install it", NOT_NOW],
      );
      if (!choice || choice === NOT_NOW) return "later";
      if (choice.startsWith("No")) { store.optOut("python"); note(ctx.cwd); return "ok"; }
      await install!(ctx);
      note(ctx.cwd);
      return "ok";
    },
  };
}

/** 4a. Security tier. */
export function levelStep(audit: AuditLogger): SetupStep {
  return {
    id: "level",
    preview: "How much BlitzPi should stop to ask you before doing things",
    done: (cwd) => describeSecurityLevel(cwd).source !== "default",
    current: (cwd) => { const d = describeSecurityLevel(cwd); return d.source === "default" ? null : `${d.level} (${d.source})`; },
    async run(ctx: StepContext): Promise<StepOutcome> {
      if (!ctx.interactive) return "later";
      const choices = [...LEVELS.map((l) => `${l} — ${LEVEL_BLURB[l]}`), NOT_NOW];
      const choice = await ctx.ui.select(`How much should BlitzPi stop to ask you in this project?\n${LEVEL_CONSTANT_NOTE}`, choices);
      if (!choice || choice === NOT_NOW) { audit.log({ type: "security_level_onboarding", decision: "later" }); return "later"; }
      const level = LEVELS.find((l) => choice.startsWith(l))!;
      setSecurityLevel(level, { cwd: ctx.cwd, via: "onboarding" }, audit);
      ctx.ui.notify(`security level: ${level} — blitzpi level changes it later`, "info");
      return "ok";
    },
  };
}

/**
 * 4b. Security feeds — LAST, per the user's ordering, and it is also the correctness fix: this was previously
 * asked FIRST, before the folder had been agreed to. Machine-scoped (`~/.blitz/feeds`), unlike every other step.
 */
export function feedsStep(audit: AuditLogger, install: (ctx: StepContext) => Promise<void>, store = new FeedStore()): SetupStep {
  return {
    id: "feeds",
    scope: "machine", // the decision and the feed store are machine-wide; deferring must not be per project
    preview: "Whether to download optional security detection feeds (machine-wide, ~4.5 MB)",
    done: () => store.decision() !== undefined,
    current: () => { const d = store.decision(); return d === "in" ? "installed" : d === "out" ? "declined" : null; },
    async run(ctx: StepContext): Promise<StepOutcome> {
      if (!ctx.interactive) return "later";
      const choice = await ctx.ui.select(
        "Security feeds (optional): detection rules from public sources — credentials in commands (gitleaks), risky command shapes (Sigma), malicious URLs (URLhaus).\nAbout 4.5 MB downloaded, ~1.5 MB kept in ~/.blitz/feeds. Updated only when you ask.",
        ["Yes — install them now", "No — don't use security feeds", NOT_NOW],
      );
      if (!choice || choice === NOT_NOW) { audit.log({ type: "feeds_onboarding", decision: "later" }); return "later"; }
      if (choice.startsWith("No")) { store.optOut(false); audit.log({ type: "feeds_onboarding", decision: "out" }); ctx.ui.notify("Security feeds declined — blitzpi feeds opt-in if you change your mind.", "info"); return "ok"; }
      audit.log({ type: "feeds_onboarding", decision: "in" });
      await install(ctx);
      return "ok";
    },
  };
}
