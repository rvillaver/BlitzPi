/**
 * The in-app opt-in. Security feeds are the user's choice, asked at install and at update — but an installer only
 * runs on update, and each update runs the PREVIOUS version's installer, so a question added to the installer reaches
 * a machine one release late (or never, if that machine was never asked). The app itself is always current, so it
 * asks: once per BlitzPi version at session start, in the TUI, while no decision is recorded. "Yes" installs the
 * feeds right here (they are live immediately — the hooks re-read rules when the feed changes); "not now" asks again
 * after the next update; "don't ask again" records an opt-out (`blitzpi feeds opt-in` reverses it).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { AuditLogger } from "../audit";
import { FeedStore, FEEDS, feedsDir, type Progress } from "./store";

export const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const progressText = (feed: string, received: number, total?: number) => `⬇ ${feed} ${fmtBytes(received)}${total ? ` / ${fmtBytes(total)} (${Math.min(100, Math.round((received / total) * 100))}%)` : ""}`;

export const FEEDS_QUESTION = "Security feeds (optional): detection rules pulled from public sources — credentials in commands (gitleaks), command shapes (Sigma), malicious URLs (URLhaus). First download ≈ 4.5 MB, kept in ~/.blitz/feeds, updated only when you say so. Install now?";
export const CHOICES = ["Yes — install the security feeds now", "Not now — ask me again after the next update", "No — don't ask again (blitzpi feeds opt-in later)"];

const askedMarker = (version: string, dir = feedsDir()) => path.join(dir, `asked-${version}`);

/** Install (or refresh) every feed in-process, reporting progress through `note`. Returns the failed feed names. */
export async function installFeeds(store: FeedStore, audit: AuditLogger | undefined, version: string | undefined, note: (m: string, kind: "info" | "warning" | "error") => void, onProgress?: Progress): Promise<string[]> {
  store.optIn();
  const failed: string[] = [];
  for (const f of FEEDS) {
    const ev = await store.update(f.name, { version, onProgress });
    audit?.log(ev as any);
    if (ev.type === "feed_update") note(`Security feeds: ${f.name} ${ev.changed ? "installed" : "up to date"} — ${ev.rules} ${f.category === "url" ? "URLs" : "rules"}, ${fmtBytes(ev.bytes)} downloaded → ${fmtBytes(ev.stored ?? 0)} stored`, "info");
    else if (ev.type === "feed_update_failed") { failed.push(f.name); note(`Security feeds: ${f.name} failed — ${ev.error}`, "error"); }
  }
  return failed;
}

/**
 * RETIRED 2026-09-05: this dialog is now step "feeds" of the single first-run flow (`src/setup/`).
 * It is no longer registered — `setupFirstRunFlow()` owns the question, in the order the user asked for.
 * Re-registering this would produce the dialog twice. The module's other exports are still used by the flow.
 */
export function setupFeedsOnboarding(pi: ExtensionAPI, audit: AuditLogger, store: FeedStore = new FeedStore(), version: string | undefined = readVersion()): void {
  pi.on("session_start", async (_event, ctx: any) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    if (store.decision()) return; // decided, either way
    const marker = askedMarker(version ?? "unknown", store["dir" as keyof FeedStore] as unknown as string);
    if (fs.existsSync(marker)) return; // "not now" for this version
    const choice = await ctx.ui.select(FEEDS_QUESTION, CHOICES);
    if (!choice || choice.startsWith("Not now")) {
      try { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, new Date().toISOString() + "\n"); } catch { /* best effort */ }
      audit.log({ type: "feeds_onboarding", decision: "later", version });
      ctx.ui.notify("Security feeds skipped for now — blitzpi feeds opt-in installs them any time.", "info");
      return;
    }
    if (choice.startsWith("No")) {
      store.optOut(false);
      audit.log({ type: "feeds_onboarding", decision: "out", version });
      ctx.ui.notify("Security feeds declined — blitzpi feeds opt-in if you change your mind.", "info");
      return;
    }
    audit.log({ type: "feeds_onboarding", decision: "in", version });
    ctx.ui.notify("Installing security feeds…", "info");
    let last = 0;
    const failed = await installFeeds(store, audit, version, (m, k) => ctx.ui.notify(m, k), (feed, received, total) => {
      const now = Date.now();
      if (now - last < 150 && received !== total) return; // throttle status redraws
      last = now;
      ctx.ui.setStatus?.("blitz-feeds", progressText(feed, received, total));
    });
    ctx.ui.setStatus?.("blitz-feeds", undefined);
    const sz = store.sizes();
    ctx.ui.notify(failed.length ? `Security feeds: ${failed.join(", ")} failed — retry with blitzpi feeds update` : `Security feeds installed and active (see /blitz-security) — ${fmtBytes(sz.total)} in ~/.blitz/feeds.`, failed.length ? "warning" : "info");
  });
}

function readVersion(): string | undefined {
  try { return require(path.join(__dirname, "..", "..", "package.json")).version as string; } catch { return undefined; }
}
