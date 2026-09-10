/**
 * What happens when BlitzPi's own initialisation goes wrong.
 *
 * Pi treats a throwing extension factory as "discard everything this extension registered, log it, carry on"
 * (`core/extensions/loader.js`: `load.discard()` then `errors.push(...); continue`). For an ordinary extension that
 * is the right call. For the one whose entire job is confinement it means the failure mode of the security layer is
 * *no security layer, agent still running* (audit 14, G14-1).
 *
 * So `blitz()` never throws. Failures are collected here and answered with actions scaled to how bad they are —
 * a warning nobody can act on is the same fail-open reflex wearing a hat.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { getConfigProblems, type ConfigProblem } from "./config";
import { info } from "./log";
import { askSelect } from "./ui-ask";

export interface ModuleFailure { module: string; critical: boolean; error: string }

const DEFAULT_CONFIG_TEXT =
  "# BlitzPi project — security config for THIS project.\nsandbox:\n  enabled: true\nfeeds:\n  # allow: []\n";

/** Run one setup step; a failure is recorded, never thrown. `critical` = the security layer needs it. */
export function step(failures: ModuleFailure[], module: string, critical: boolean, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    failures.push({ module, critical, error: e instanceof Error ? e.message : String(e) });
  }
}

function describe(configProblems: ConfigProblem[], failures: ModuleFailure[]): string {
  const lines: string[] = [];
  for (const p of configProblems) lines.push(`  ${p.scope} config — ${p.file}\n    ${p.error}`);
  for (const f of failures) lines.push(`  ${f.critical ? "SECURITY" : "optional"} module "${f.module}"\n    ${f.error}`);
  return lines.join("\n");
}

/**
 * Register the recovery flow. Always called, even when everything succeeded (it then does nothing), so that the
 * handler exists no matter which step failed.
 */
export function setupInitRecovery(pi: ExtensionAPI, failures: ModuleFailure[], core: { failed: string | null }): void {
  // Registered FIRST, before any other `session_start` handler, and reading `failures`/`core` through the closure
  // once the session actually starts. Registering it last put the recovery dialog behind the first-run setup
  // flow's blocking `ui.select`, so a user with an unreadable config was asked to choose a project profile before
  // being told anything was wrong — and that choice then could not be saved, because saving means editing the
  // very file that would not parse. Caught by a pty run, 2026-09-10; no headless probe would have shown it.
  pi.on("session_start", async (_e: any, ctx: ExtensionContext) => {
    const configProblems = getConfigProblems();
    const coreFailed = core.failed;
    const critical = coreFailed !== null || failures.some((f) => f.critical);
    const optional = failures.filter((f) => !f.critical);
    if (!configProblems.length && !failures.length && !coreFailed) return;

  // Say it once on the console regardless of surface — a TUI notification cannot paint through teardown, and
  // print mode has no TUI at all (see project memory).
  if (coreFailed) info(`[Blitz Pi] ✗ core initialisation failed: ${coreFailed}`);
  for (const p of configProblems) info(`[Blitz Pi] ⚠ ${p.scope} config could not be read (${p.file}): ${p.error} — built-in defaults are in force, your settings are NOT active`);
  for (const f of failures) info(`[Blitz Pi] ${f.critical ? "✗ SECURITY" : "⚠ optional"} module "${f.module}" failed: ${f.error}`);

    const interactive = ctx.mode === "tui" && ctx.hasUI;

    // Nobody to ask: fixed policy. A config we cannot read costs the policy; enforcement we cannot install costs
    // the session. Same reasoning as the permission gate's unattended path (permission-gate.ts:64-67).
    if (!interactive) {
      if (critical) {
        console.error(`[BlitzPi] Refusing to run: the security layer could not be installed.\n${describe(configProblems, failures)}\nBlitzPi does not start an unguarded agent in a non-interactive run.`);
        process.exit(1);
      }
      return;
    }

    if (critical) {
      const choice = await askSelect(ctx, 
        `BlitzPi could not install its security layer.\n\n${describe(configProblems, failures)}\n\nThe agent would run with no sandbox and no governance.`,
        ["Exit", "Continue with NO sandbox (I understand the risk)"],
      );
      if (choice !== "Continue with NO sandbox (I understand the risk)") {
        info("\n[BlitzPi] Exiting — the security layer could not be installed. Nothing was run.");
        process.exit(1);
      }
      ctx.ui.notify("Running UNGUARDED — no sandbox, no governance, no audit. Restart BlitzPi once the problem above is fixed.", "warning");
      return;
    }

    if (configProblems.length) {
      const cwd = process.cwd();
      for (;;) {
        const choice = await askSelect(ctx, 
          `BlitzPi could not read your configuration, so your project policy is NOT active — it is running on built-in defaults.\n\n${describe(configProblems, [])}`,
          ["Retry (I fixed the file)", "Reset it to the default config", "Continue on defaults for this session", "Exit"],
        );
        if (choice === "Retry (I fixed the file)") {
          const { loadConfig } = require("./config");
          try { loadConfig(); } catch { /* collected, not thrown */ }
          const still = getConfigProblems();
          if (!still.length) { ctx.ui.notify("Configuration read successfully — restart BlitzPi so it takes effect.", "info"); return; }
          ctx.ui.notify(`Still unreadable: ${still[0].error}`, "warning");
          continue;
        }
        if (choice === "Reset it to the default config") {
          const f = path.join(cwd, ".blitz", "blitz.config.yaml");
          try {
            fs.copyFileSync(f, `${f}.broken`);
            fs.writeFileSync(f, DEFAULT_CONFIG_TEXT);
            ctx.ui.notify(`Reset. Your previous file is kept at ${f}.broken — restart BlitzPi so it takes effect.`, "info");
          } catch (e) {
            ctx.ui.notify(`Could not reset it: ${e instanceof Error ? e.message : String(e)}`, "warning");
          }
          return;
        }
        if (choice === "Continue on defaults for this session") {
          ctx.ui.notify("Continuing on built-in defaults — your project policy is not active.", "warning");
          return;
        }
        // Exit, or the dialog was dismissed: the safe branch, deliberately.
        info("\n[BlitzPi] Exiting — configuration could not be read.");
        process.exit(1);
      }
    }

    if (optional.length) {
      ctx.ui.notify(`Not available this session: ${optional.map((f) => f.module).join(", ")}. The security layer is unaffected.`, "warning");
    }
  });
}
