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
import { renderEvents, type EventKind } from "../session-events";
import { buildReport, renderReport } from "../report";
import { info } from "../log";
import { ownSkillsLine } from "./own-skills";
import { awaitCapabilities, capabilityLine } from "../sandbox-probe";

const banner = (config: BlitzConfig) => [
  "",
  "  ⚡ BLITZ PI  —  Pi with security governance",
  `     ${summaryLine(config, activeBackendName())}`,
  // Omitted entirely until the in-sandbox probe has answered — a header that guesses at the toolchain is worse
  // than one that stays quiet, and waiting for it would put the probe back on the startup path.
  ...(capabilityLine() ? [capabilityLine() as string] : []),
  "     /blitz-security shows every layer, its mode and this session's decisions · /blitz-report this project · /session usage",
  "     ctrl+t folds/unfolds thinking (folded by default in a BlitzPi project) · shift+tab cycles thinking level",
  `     ${ownSkillsLine()}`,
  "",
].join("\n");

export function show(pi: ExtensionAPI, ctx: { hasUI: boolean }, content: string): void {
  if (ctx.hasUI) {
    pi.sendMessage({ customType: "blitz-status", content, display: true });
  } else {
    info(content); // print/json mode: no TUI to render the message
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
  info(banner(config)); // startup scrollback; the TUI header below carries the same summary
  // The banner above is printed during extension setup — earlier than the in-sandbox probe can possibly answer
  // (it spawns a real backend process). Rather than hold the banner for it, report it as its own line when it
  // lands. `void` is deliberate: nothing on the startup path may await this.
  void awaitCapabilities(2_000).then((c) => { if (c) info(capabilityLine() as string); });
  const KINDS: Record<string, EventKind | "all"> = { files: "file", file: "file", bash: "bash", governance: "governance", gov: "governance", profile: "profile", threats: "threat", threat: "threat", packages: "feed", feed: "feed", feeds: "feed", content: "content", all: "all" };
  pi.registerCommand("blitz-security", {
    description: "Security layers, modes and this session's decisions. Inspect: /blitz-security files | bash | governance | packages | content | all",
    handler: async (args: string, ctx) => {
      const kind = KINDS[(args ?? "").trim().toLowerCase()];
      if (kind) { show(pi, ctx, renderEvents(kind)); return; }
      const recent = lastAuditLines(audit.getPath(), 5).map((l) => {
        try { const e = JSON.parse(l); return `${String(e.timestamp ?? "").slice(11, 19)} ${e.type}${e.tool ? " " + e.tool : ""}${e.zone ? " " + e.zone : ""}${e.allowed === false || e.approved === false ? " ✗" : " ✓"}${e.reason ? " — " + String(e.reason).slice(0, 60) : ""}`; } catch { return l.slice(0, 100); }
      });
      show(pi, ctx, panel(config, activeBackendName(), recent, audit.getSessionFile()));
    },
  });
  pi.registerCommand("blitz-report", {
    description: "This project across sessions: files read/written/deleted, URLs, commands, governance, usage (from the audit trail + Pi's session logs)",
    handler: async (args: string, ctx) => {
      const since = (args ?? "").trim() || undefined;
      show(pi, ctx, renderReport(buildReport(process.cwd(), { since, auditPath: audit.getPath() })));
    },
  });
  pi.registerCommand("blitz-level", {
    description: "How much BlitzPi stops to ask. No arg: show it. /blitz-level strict|guarded|monitored [--global] to change it (this project by default, --global for every project on this machine)",
    handler: async (args: string, ctx) => {
      const { LEVELS, LEVEL_BLURB, LEVEL_CONSTANT_NOTE, describeSecurityLevel, setSecurityLevel } = await import("../security-level");
      const words = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const global = words.includes("--global");
      const value = words.find((w) => !w.startsWith("-"));
      if (!value) {
        const { level, source } = describeSecurityLevel();
        const lines = [`security level: ${level} (${source === "default" ? "built-in default — no config sets it" : `set in ${source} config`})`,
          ...LEVELS.map((l) => `  ${l === level ? "*" : " "} ${l.padEnd(10)} ${LEVEL_BLURB[l]}`),
          `  ${LEVEL_CONSTANT_NOTE}`];
        return show(pi, ctx, lines.join("\n"));
      }
      if (!(LEVELS as string[]).includes(value)) return show(pi, ctx, `unknown level "${value}" — one of: ${LEVELS.join(", ")}`);
      const { from, file } = setSecurityLevel(value as (typeof LEVELS)[number], { global }, audit);
      show(pi, ctx, `security level: ${from} -> ${value} (${file}) — takes effect next session start`);
    },
  });
  // Replace Pi's startup header and the terminal title (TUI only). Applied now and again after every
  // session_start handler has run: pi-cc-extensions (bundled) resets the header to Pi's default in its own
  // session_start, which runs after ours — the deferred call puts BlitzPi's header back.
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const apply = () => ctx.ui.setHeader((_tui, theme) => {
      return {
        render(_width: number): string[] {
          return [
            "",
            theme.fg("accent", "  ⚡ BLITZ PI"),
            theme.fg("dim", "  Pi with security governance · sandbox · governance · audit"),
            theme.fg("dim", `  ${summaryLine(config, activeBackendName())}`),
            // render() is called again on every invalidate, so this appears as soon as the probe answers.
            // Nothing waits for it: an absent line means "not known yet", never "nothing is installed".
            ...(capabilityLine() ? [theme.fg("dim", `  ${(capabilityLine() as string).trim()}`)] : []),
            theme.fg("dim", "  /blitz-security · /blitz-report · /blitz-level · /session · /adopt-goodbehavior"),
            theme.fg("dim", "  ctrl+t folds/unfolds thinking · shift+tab cycles thinking level"),
            theme.fg("dim", `  ${ownSkillsLine()}`),
            "",
          ];
        },
        invalidate() {},
      };
    });
    apply();
    setTimeout(apply, 0);
    ctx.ui.setTitle(`blitzpi – ${path.basename(ctx.cwd)}`);
  });




}
