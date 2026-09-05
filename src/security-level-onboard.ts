/**
 * SP-4: the in-app first-run question for the security tier — same shape as feeds/onboard.ts (asked once per
 * BlitzPi version while undecided, "not now" defers to the next update, the decision is audited) and for the
 * same reason: the app is always current, an installer question would reach a machine a release late.
 * Scoped to the PROJECT (not the machine): the tier is naturally a per-project choice — an expert on a
 * client's box may want `strict` while the same person's throwaway project wants `monitored` — so "already
 * decided" means either this project or the global default has an explicit value (describeSecurityLevel's
 * `source !== "default"`), and the marker for "asked, come back next version" lives in the project's own
 * `.blitz/`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { AuditLogger } from "./audit";
import { LEVELS, LEVEL_BLURB, LEVEL_CONSTANT_NOTE, describeSecurityLevel, setSecurityLevel } from "./security-level";

export const LEVEL_QUESTION = `How much should BlitzPi stop to ask you in this project?\n${LEVEL_CONSTANT_NOTE}`;
export const NOT_NOW = "Not now — ask me again after the next update";
export const CHOICES = [...LEVELS.map((l) => `${l} — ${LEVEL_BLURB[l]}`), NOT_NOW];

const askedMarker = (cwd: string, version: string) => path.join(cwd, ".blitz", `.level-asked-${version}`);

/**
 * RETIRED 2026-09-05: this dialog is now step "level" of the single first-run flow (`src/setup/`).
 * It is no longer registered — `setupFirstRunFlow()` owns the question, in the order the user asked for.
 * Re-registering this would produce the dialog twice. The module's other exports are still used by the flow.
 */
export function setupSecurityLevelOnboarding(pi: ExtensionAPI, audit: AuditLogger, version: string | undefined = readVersion()): void {
  pi.on("session_start", async (_event, ctx: any) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    const cwd = process.cwd();
    if (describeSecurityLevel(cwd).source !== "default") return; // already decided, at project or global scope
    const marker = askedMarker(cwd, version ?? "unknown");
    if (fs.existsSync(marker)) return; // "not now" for this version
    const choice = await ctx.ui.select(LEVEL_QUESTION, CHOICES);
    if (!choice || choice === NOT_NOW) {
      try { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, new Date().toISOString() + "\n"); } catch { /* best effort */ }
      audit.log({ type: "security_level_onboarding", decision: "later", version });
      return;
    }
    const level = LEVELS.find((l) => choice.startsWith(l))!;
    setSecurityLevel(level, { cwd, via: "onboarding" }, audit);
    ctx.ui.notify(`security level: ${level} — /blitz-level to change it later`, "info");
  });
}

function readVersion(): string | undefined {
  try { return require(path.join(__dirname, "..", "package.json")).version as string; } catch { return undefined; }
}
