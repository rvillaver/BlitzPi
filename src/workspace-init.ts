/**
 * First-run workspace gate. If the launch folder has no `.blitz/`, ask before working in it — so the
 * agent is never exposed to a folder the user didn't intend. Yes: initialize the project AND adopt the
 * GoodBehavior workflow into it. No: exit. Interactive only (`-p`/unattended proceeds without prompting).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { adoptGoodBehavior } from "./adopt-goodbehavior";
import { touchProject } from "./projects";

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

/**
 * Pi resolves `npm:` packages with `npm root -g` unless `npmCommand` is set; BlitzPi users need not have npm.
 * Point Pi's package operations at the runtime running BlitzPi (the private Bun when installed) — in the
 * PROJECT's .pi/settings.json (the user just consented to set this folder up), never in user settings.
 */
export function pinPackageManager(cwd: string): void {
  try {
    const f = path.join(cwd, ".pi", "settings.json");
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(fs.readFileSync(f, "utf-8")); } catch { /* new */ }
    if (cur.npmCommand) return;
    cur.npmCommand = [process.execPath];
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(cur, null, 2) + "\n");
  } catch { /* best effort */ }
}

export function setupWorkspaceInit(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, ".blitz"))) return; // already a BlitzPi project

    const hasFiles = fs.readdirSync(cwd).some((f) => !f.startsWith("."));
    const choice = await ctx.ui.select(
      `Set up this folder as your BlitzPi project?\n  ${cwd}${hasFiles ? "\n  (it already contains files — they become your workspace)" : ""}`,
      ["Yes — trust & set up here", "No — exit"],
    );

    if (!choice || choice.startsWith("No")) {
      ctx.ui.notify("Not this folder — exiting. Start BlitzPi in the folder you want to work in.", "warning");
      process.exit(0);
    }

    fs.mkdirSync(path.join(cwd, ".blitz"), { recursive: true });
    const cfg = path.join(cwd, ".blitz", "blitz.config.yaml");
    if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, "# BlitzPi project — security config for THIS project.\nsandbox:\n  enabled: true\n");
    const n = adoptGoodBehavior(cwd).installed.filter((f) => f.endsWith("SKILL.md")).length;
    pinPackageManager(cwd);
    trustProject(cwd); // user consented — record Pi trust so the project loads with no extra prompt
    try { touchProject(cwd, { version: require("../package.json").version }); } catch { /* registry is best-effort */ }
    // A persistent chat message (not a toast) so the restart step can't be missed.
    pi.sendMessage({
      customType: "blitz-setup",
      content:
        `BlitzPi project set up in ${cwd}\n` +
        `- ${n} GoodBehavior skills installed in .pi/skills; doctrine in .blitz/goodbehavior/profiles/\n` +
        `- security config in .blitz/\n\n` +
        `ACTION NEEDED: the skills load at startup, so RESTART BlitzPi in this folder to activate them ` +
        `(press ctrl+d to quit, then run 'blitzpi' again). After that, /skill:audit-goodbehavior and the rest are available.`,
      display: true,
    });
    ctx.ui.notify(`Project set up — restart BlitzPi here to activate the ${n} GoodBehavior skills.`, "warning");
  });
}
