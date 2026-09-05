/**
 * One guided first-run flow (ONBOARDING-SETUP S4b-S4f), in the order the user asked for:
 *
 *   intro → trust the folder → profile → runtimes → security (tier, then feeds)
 *
 * Replaces four uncoordinated `session_start` dialogs that fired in registration order, which meant **feeds was
 * asked first** — before the user had even agreed to set the folder up (`src/index.ts:67` registers before `:72`).
 * Nothing here invents new questions: each step reuses the wording its own module already exports, so the flow is
 * a sequencer, not a second copy of the questions.
 *
 * Every step is skippable and re-runnable. A step reports `done()` from the same state its standalone command
 * reads, so `blitzpi setup` can show current answers instead of blindly re-asking — the state IS the marker.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** What a step did. "later" is a first-class outcome, not a failure — see the defer marker below. */
export type StepOutcome = "ok" | "later" | "abort";

export interface StepContext {
  cwd: string;
  ui: ExtensionContext["ui"];
  /** Non-interactive run: a step must state its assumption rather than guess or hang. */
  interactive: boolean;
}

export interface SetupStep {
  id: string;
  /** One line, user-facing, for the "here's what I'll ask you" preview. No internal vocabulary. */
  preview: string;
  /** Already answered? Read from the real state, never from a separate "asked" flag that can drift. */
  done: (cwd: string) => boolean;
  /** What the current answer is, for a re-run. null when unanswered. */
  current: (cwd: string) => string | null;
  /** Ask. "abort" stops the whole flow (only the trust step does that — declining means "not this folder"). */
  run: (ctx: StepContext) => Promise<StepOutcome>;
  /** Where "not now" is remembered. Feeds are machine-wide (`~/.blitz`); everything else is per project. */
  scope?: "project" | "machine";
  /** Shows something rather than asking something (the welcome). Never listed as an "answer" on a re-run. */
  informational?: boolean;
}

/**
 * "Not now" has to stick, or the flow becomes the nag it replaced.
 *
 * The standalone dialogs this flow supersedes each kept a per-version marker so deferring lasted until the next
 * update; dropping that would re-ask every single session (the H5 failure, which the profile nudge already had).
 * Keyed by version deliberately: a new BlitzPi is a fair reason to ask once more, an ordinary restart is not.
 */
export const deferMarker = (cwd: string, id: string, version: string, scope: "project" | "machine" = "project") =>
  path.join(scope === "machine" ? os.homedir() : cwd, ".blitz", `.setup-${id}-deferred-${version}`);

export function isDeferred(cwd: string, step: SetupStep, version: string): boolean {
  return fs.existsSync(deferMarker(cwd, step.id, version, step.scope));
}

export function recordDeferral(cwd: string, step: SetupStep, version: string): void {
  const f = deferMarker(cwd, step.id, version, step.scope);
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, new Date().toISOString() + "\n"); } catch { /* best effort */ }
}

/**
 * The introduction (S4b). A first-time folder currently opens with a dense capability banner and no explanation
 * of what BlitzPi is or what it is about to ask — the user's words: *"we have a lot of text at the beginning, but
 * we need to be introducing BlitzPi to the user, what's it for and what are we asking next steps"*.
 *
 * Shown only when the folder is not set up yet; established projects keep the compact banner.
 */
export function introText(cwd: string, steps: SetupStep[]): string {
  const asks = steps.map((s, i) => `  ${i + 1}. ${s.preview}`).join("\n");
  return [
    "Welcome to BlitzPi.",
    "",
    "It's a coding agent that runs under a security layer: shell commands execute inside a sandbox confined to",
    "this folder, file writes and risky commands are checked before they run, and everything is audited. You stay",
    "in control of what it's allowed to do.",
    "",
    `This is the first time you've run it in ${cwd}, so there are a few one-time questions:`,
    "",
    asks,
    "",
    "You can skip any of them and change your mind later — `blitzpi setup` re-runs this, and each answer has its",
    "own command (`blitzpi level`, `blitzpi feeds`). Nothing is written to this folder until you say yes to step 1.",
  ].join("\n");
}

/** Run the steps in order. Stops early only if a step aborts (declining the folder). */
export async function runSteps(
  steps: SetupStep[],
  ctx: StepContext,
  opts: { only?: string[]; version?: string; force?: boolean } = {},
): Promise<{ ran: string[]; skipped: string[]; deferred: string[]; aborted: boolean }> {
  const ran: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  const version = opts.version ?? "unknown";
  for (const step of steps) {
    if (opts.only && !opts.only.includes(step.id)) continue;
    // `force` is how `blitzpi setup` re-asks something you already answered or deferred.
    if (!opts.force) {
      if (step.done(ctx.cwd)) { skipped.push(step.id); continue; }
      if (isDeferred(ctx.cwd, step, version)) { deferred.push(step.id); continue; }
    }
    const outcome = await step.run(ctx);
    if (outcome === "later") { recordDeferral(ctx.cwd, step, version); deferred.push(step.id); continue; }
    ran.push(step.id);
    if (outcome === "abort") return { ran, skipped, deferred, aborted: true };
  }
  return { ran, skipped, deferred, aborted: false };
}

/** For a re-run: what every step currently says, so `blitzpi setup` shows answers instead of re-asking. */
export function currentAnswers(steps: SetupStep[], cwd: string): { id: string; preview: string; answer: string }[] {
  return steps.filter((s) => !s.informational).map((s) => ({ id: s.id, preview: s.preview, answer: s.current(cwd) ?? "not set" }));
}
