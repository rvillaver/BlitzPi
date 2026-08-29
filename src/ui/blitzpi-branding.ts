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

const BANNER = [
  "",
  "  ⚡ BLITZ PI  —  Pi with security governance",
  "     access profiles · file sandbox (bwrap) · governance gate · threat detection · audit trail",
  "     /blitz-security   /blitz-profile   /blitz-audit",
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
  console.log(BANNER); // renders in startup scrollback (setHeader does not replace Pi's mascot in 0.84.3)
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
            theme.fg("dim", "  /blitz-security  /blitz-profile  /blitz-audit"),
            "",
          ];
        },
        invalidate() {},
      };
    });
    ctx.ui.setTitle(`blitzpi – ${path.basename(ctx.cwd)}`);
  });




}
