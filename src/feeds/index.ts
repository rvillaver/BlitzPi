/**
 * Feeds layer — detection sources that update themselves. Phase 1: the package feed. Every `bash`/`powershell`
 * call that installs packages is checked against OSV before it runs: a known-malicious package (`MAL-*`) is
 * blocked (`feeds.packages: enforce`), or recorded and shown (`monitor`). An unreachable feed never enforces:
 * the install proceeds and the outage is audited — the same rule as governance outages.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BlitzConfig } from "../config";
import type { AuditLogger } from "../audit";
import { stats } from "../security-status";
import { parseInstalls } from "./packages";
import { OsvClient, maliciousOf, type CheckResult } from "./osv";
import { redactCommand } from "./secrets";

export function describeBlock(r: CheckResult): string {
  return maliciousOf(r).map((v) => `${v.ecosystem} "${v.name}" is a known malicious package (${v.malicious.join(", ")}${v.summary ? ": " + v.summary : ""})`).join("; ");
}

export function setupFeeds(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, client: OsvClient = new OsvClient({ ttlHours: config.feeds.cache_ttl_hours })): void {
  const mode = config.feeds.packages;
  if (mode === "off") { console.log("[Blitz:Feeds] package feed off"); return; }
  console.log(`[Blitz:Feeds] package feed (OSV) ${mode}`);

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const tool = (event as any).toolName as string;
    if (tool !== "bash" && tool !== "powershell") return;
    const command: string = (event as any).input?.command ?? "";
    const pkgs = parseInstalls(command);
    if (!pkgs.length) return;

    const r = await client.check(pkgs);
    const bad = maliciousOf(r);
    if (r.unreachable) {
      stats.feeds.unreachable++;
      audit.log({ type: "feed_unreachable", feed: "osv", packages: pkgs.map((p) => `${p.ecosystem}:${p.name}`), error: r.error, command: redactCommand(command).slice(0, 300) });
      if (ctx.hasUI) ctx.ui.notify(`Package feed (OSV) unreachable — ${pkgs.length} package(s) installed unchecked (${r.error ?? "no response"})`, "warning");
    }
    stats.feeds.checked += r.verdicts.length;
    audit.log({
      type: "feed_check", feed: "osv", mode, allowed: !(bad.length && mode === "enforce"),
      packages: r.verdicts.map((v) => ({ ecosystem: v.ecosystem, name: v.name, malicious: v.malicious, cached: v.cached })),
      malicious: bad.map((v) => `${v.ecosystem}:${v.name}`), command: redactCommand(command).slice(0, 300),
    });
    if (!bad.length) return;

    stats.feeds.malicious += bad.length;
    stats.feeds.last = describeBlock(r);
    if (mode === "enforce") {
      stats.blocked.feed++;
      return { block: true, reason: `[BLOCKED] package feed: ${describeBlock(r)}. The install did not run.` };
    }
    if (ctx.hasUI) ctx.ui.notify(`Package feed (monitor): ${describeBlock(r)} — the install still ran; set feeds.packages: enforce to block`, "error");
  });
}
