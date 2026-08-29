/**
 * BlitzPi identity + status commands.
 * Commands report LIVE state (config, loaded profile, audit trail) — nothing hard-coded.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "fs";
import os from "os";
import path from "path";
import { load } from "js-yaml";
import type { BlitzConfig } from "../config";
import type { AuditLogger } from "../audit";

import { activeBackendName } from "../sandbox-bash";
import { panel, summaryLine } from "../security-status";

const banner = (config: BlitzConfig) => [
  "",
  "  ⚡ BLITZ PI  —  Pi with security governance",
  `     ${summaryLine(config, activeBackendName())}`,
  "     /blitz-security shows every layer, its mode and this session's decisions",
  "",
].join("\n");

function show(pi: ExtensionAPI, ctx: { hasUI: boolean }, content: string): void {
  if (ctx.hasUI) {
    pi.sendMessage({ customType: "blitz-status", content, display: true });
  } else {
    console.log(content); // print/json mode: no TUI to render the message
  }
}

function findProfile(name: string): { file?: string; rules?: unknown[] } {
  const dirs = [path.join(process.cwd(), ".blitz", "profiles"), path.join(os.homedir(), ".blitz", "profiles")];
  for (const dir of dirs) {
    const file = path.join(dir, `${name}.yaml`);
    if (fs.existsSync(file)) {
      try {
        const parsed = load(fs.readFileSync(file, "utf-8")) as { rules?: unknown[] };
        return { file, rules: parsed?.rules ?? [] };
      } catch {
        return { file };
      }
    }
  }
  return {};
}

function lastAuditLines(auditPath: string, n: number): string[] {
  if (!fs.existsSync(auditPath)) return [];
  const files = fs.readdirSync(auditPath).filter((f) => f.endsWith(".jsonl")).sort();
  const lines: string[] = [];
  for (const f of files.reverse()) {
    const content = fs.readFileSync(path.join(auditPath, f), "utf-8").trim();
    if (content) lines.unshift(...content.split("\n"));
    if (lines.length >= n) break;
  }
  return lines.slice(-n);
}

export function setupBlitzPiBranding(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger): void {
  console.log(banner(config)); // renders in startup scrollback (setHeader does not replace Pi's mascot in 0.84.3)
  pi.registerCommand("blitz-security", {
    description: "Security layers: mode (enforce / monitor / off), configuration, and this session's decisions",
    handler: async (_args: string, ctx) => {
      const recent = lastAuditLines(audit.getPath(), 5).map((l) => {
        try { const e = JSON.parse(l); return `${String(e.timestamp ?? "").slice(11, 19)} ${e.type}${e.tool ? " " + e.tool : ""}${e.zone ? " " + e.zone : ""}${e.allowed === false || e.approved === false ? " ✗" : " ✓"}${e.reason ? " — " + String(e.reason).slice(0, 60) : ""}`; } catch { return l.slice(0, 100); }
      });
      show(pi, ctx, panel(config, activeBackendName(), recent));
    },
  });
  // Replace Pi's startup header and the terminal title (TUI only).
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((_tui, theme) => {
      return {
        render(_width: number): string[] {
          return [
            "",
            theme.fg("accent", "  ⚡ BLITZ PI"),
            theme.fg("dim", "  Pi with security governance · sandbox · governance · audit"),
            theme.fg("dim", `  ${summaryLine(config, activeBackendName())}`),
            theme.fg("dim", "  /blitz-security · /adopt-goodbehavior"),
            "",
          ];
        },
        invalidate() {},
      };
    });
    ctx.ui.setTitle(`blitzpi – ${path.basename(ctx.cwd)}`);
  });




}
