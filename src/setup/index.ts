/**
 * The first-run flow's entry points: one `session_start` orchestrator, and the `blitzpi setup` verb.
 *
 * This is what replaces the four independent `session_start` dialogs. Their registration order decided the
 * question order, which is why feeds — machine-wide, and the least urgent — was asked before the user had agreed
 * to set the folder up at all.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AuditLogger } from "../audit";
import { adoptGoodBehavior, isProjectSetUp } from "../adopt-goodbehavior";
import { pinPackageManager, seedThinkingDisplay } from "../workspace-init";
import { touchProject } from "../projects";
import { installFeeds } from "../feeds/onboard";
import { FeedStore } from "../feeds/store";
import { RuntimeStore } from "../runtimes/store";
import { PYTHON_VERSION } from "../runtimes/pinned";
import { info } from "../log";

function blitzVersion(): string {
  try { return require("../../package.json").version as string; } catch { return "unknown"; }
}
import { currentAnswers, introText, runSteps, type SetupStep, type StepContext } from "./steps";
import { feedsStep, introStep, levelStep, profileStep, runtimeStep, trustStep } from "./flow";

function configuredProfile(cwd: string): string {
  try {
    const f = path.join(cwd, ".blitz", "blitz.config.yaml");
    const cfg = require("js-yaml").load(fs.readFileSync(f, "utf-8")) as { goodbehavior?: { profile?: string } };
    return cfg?.goodbehavior?.profile ?? "development";
  } catch { return "development"; }
}

/** Point `goodbehavior.profile` at a core profile and copy it in. Regex, not parse-reserialize: keeps comments. */
function selectProfile(cwd: string, name: string): void {
  adoptGoodBehavior(cwd, name);
  const f = path.join(cwd, ".blitz", "blitz.config.yaml");
  let text = "";
  try { text = fs.readFileSync(f, "utf-8"); } catch { /* new */ }
  text = /^goodbehavior:/m.test(text)
    ? text.replace(/^goodbehavior:\n(\s+profile:.*\n)?/m, `goodbehavior:\n  profile: ${name}\n`)
    : `${text}${text.endsWith("\n") || !text ? "" : "\n"}goodbehavior:\n  profile: ${name}\n`;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } catch { /* best effort */ }
}

function trustProject(cwd: string): void {
  try {
    const f = path.join(os.homedir(), ".pi", "agent", "trust.json");
    let t: Record<string, boolean> = {};
    try { t = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { /* new */ }
    t[cwd] = true;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(t, null, 2));
  } catch { /* best effort */ }
}

/** Everything the consented setup does. Nothing here runs before the trust step returns yes. */
function initialiseProject(cwd: string): void {
  fs.mkdirSync(path.join(cwd, ".blitz"), { recursive: true });
  const cfg = path.join(cwd, ".blitz", "blitz.config.yaml");
  if (!fs.existsSync(cfg)) {
    fs.writeFileSync(cfg, "# BlitzPi project — security config for THIS project.\nsandbox:\n  enabled: true\n  # cache: shared   # package-manager caches: shared = ~/.blitz/cache/<tool> (default) | project | off\nfeeds:\n  # allow: []       # rule ids accepted as false positives (audit feed_* hits[].id)\n  # min_release_age: 3d   # Bun: no versions newer than this (off to disable)\n");
  }
  adoptGoodBehavior(cwd);
  pinPackageManager(cwd);
  seedThinkingDisplay(cwd);
  trustProject(cwd);
  try { touchProject(cwd, { version: require("../../package.json").version }); } catch { /* best effort */ }
}

export function buildSteps(audit: AuditLogger, store = new FeedStore(), runtimeStore = new RuntimeStore()): SetupStep[] {
  // `steps` is self-referential: the intro previews the questions that follow it, so it is built from the rest.
  const rest: SetupStep[] = [
    trustStep(initialiseProject, () => {
      // Declining is not an error and must leave nothing behind — the folder is untouched at this point.
      // Printed, not notified: the process exits immediately, and a TUI notification cannot paint through
      // teardown (the old workspace-init had the same silent-exit problem). console output survives it.
      info("\n[BlitzPi] Not this folder — exiting, nothing was written. Start BlitzPi in the folder you want to work in.");
      process.exit(0);
    }),
    profileStep(configuredProfile, selectProfile),
    runtimeStep(async (ctx) => {
      ctx.ui.notify(`Downloading Python ${PYTHON_VERSION} — this is a large download.`, "info");
      const r = await runtimeStore.install("python", {
        onProgress: (recv, total) => ctx.ui.setStatus?.("blitz-runtime", `⬇ python ${(recv / 1048576).toFixed(0)}${total ? `/${(total / 1048576).toFixed(0)}` : ""} MB`),
      });
      ctx.ui.setStatus?.("blitz-runtime", undefined);
      ctx.ui.notify(
        r.type === "runtime_install_failed"
          ? `Python install failed — ${r.error}. Nothing was changed; blitzpi runtimes install retries.`
          : `Python ${r.version} installed — the agent's sandboxed shell can use it now. Your own PATH is unchanged.`,
        r.type === "runtime_install_failed" ? "warning" : "info",
      );
    }, runtimeStore),
    levelStep(audit),
    feedsStep(audit, async (ctx) => {
      ctx.ui.notify("Installing security feeds…", "info");
      const failed = await installFeeds(store, audit, undefined, (m, k) => ctx.ui.notify(m, k as any));
      ctx.ui.notify(failed.length ? `Security feeds: ${failed.join(", ")} failed — retry with blitzpi feeds update` : "Security feeds installed and active (see /blitz-security).", failed.length ? "warning" : "info");
    }, store),
  ];
  // Every question the user will actually be asked, trust included — the intro promises "step 1" is the
  // consent one, so leaving it out of the list made the promise point at the wrong step.
  return [introStep((cwd) => introText(cwd, rest)), ...rest];
}

export function setupFirstRunFlow(pi: ExtensionAPI, audit: AuditLogger): void {
  const steps = buildSteps(audit);
  pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const cwd = process.cwd();
    const firstRun = !isProjectSetUp(cwd);

    // An established project keeps the compact banner and is never re-introduced; it only gets steps it has
    // genuinely never answered (e.g. feeds on a new machine), so this is not a second ambush dialog.
    if (!firstRun) {
      if (seedThinkingDisplay(cwd)) ctx.ui.notify("Thinking now folds by default in this project (ctrl+t to expand/collapse) — .pi/settings.json: hideThinkingBlock", "info");
    }

    const stepCtx: StepContext = { cwd, ui: ctx.ui, interactive: true };
    const r = await runSteps(steps, stepCtx, { version: blitzVersion() });
    if (r.aborted) return;
    if (firstRun) {
      pi.sendMessage({
        customType: "blitz-setup",
        content: `BlitzPi is set up in ${cwd}\n` +
          `- GoodBehavior's skills ship with BlitzPi and are active now — nothing installed into your folder\n` +
          `- profile: ${configuredProfile(cwd)} (.blitz/goodbehavior/profiles/)\n` +
          `- security config in .blitz/ · change any answer later with blitzpi setup`,
        display: true,
      });
    }
  });

  pi.registerCommand("setup", {
    description: "Re-run BlitzPi's first-run setup for this project: shows your current answers and lets you change them.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const cwd = process.cwd();
      const lines = currentAnswers(steps, cwd).map((a) => `  ${a.preview}\n    → ${a.answer}`);
      pi.sendMessage({ customType: "blitz-setup", content: `BlitzPi setup — ${cwd}\n\n${lines.join("\n")}`, display: true });
      if (!ctx.hasUI) return;
      const askable = steps.filter((s) => !s.informational);
      const pick = await ctx.ui.select("Change any of these?", [...askable.map((s) => s.preview), "No — leave everything as it is"]);
      if (!pick || pick.startsWith("No —")) return;
      const step = askable.find((s) => s.preview === pick);
      if (!step) return;
      // force: an explicit re-run must re-ask even something already answered or deferred.
      await runSteps(steps, { cwd, ui: ctx.ui, interactive: true }, { only: [step.id], version: blitzVersion(), force: true });
    },
  });

  info("[Blitz:Setup] first-run flow ready (blitzpi setup / /setup re-runs it)");
}
