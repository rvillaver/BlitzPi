/**
 * One vocabulary for every security layer — `enforce` (the runtime blocks), `monitor` (recorded + shown, not
 * blocked), `off` — plus per-session counters. Everything user-facing (banner, status bar, /blitz-security)
 * derives from here, so the story is consistent and nothing is hard-coded prose.
 */
import type { BlitzConfig } from "./config";
import { FeedStore } from "./feeds/store";

/** Is the (opt-in) secrets feed present on this machine? Read once per render; cheap (two stat calls). */
export function secretsFeedInstalled(store: FeedStore = new FeedStore()): boolean { return store.optedIn() && store.installed("secrets"); }
export function feedInstalled(name: string, store: FeedStore = new FeedStore()): boolean { return store.optedIn() && store.installed(name); }

export type Mode = "enforce" | "monitor" | "off";
export interface Layer { key: string; name: string; mode: Mode; detail: string; configured: string }

export const stats = {
  governance: { checked: 0, denied: 0, unreachable: 0, lastDenial: "" },
  blocked: { profile: 0, sandbox: 0, bash: 0, threat: 0, input: 0, feed: 0 },
  feeds: { checked: 0, malicious: 0, unreachable: 0, last: "", secrets: 0, commands: 0, urls: 0 },
  content: { scanned: 0, flagged: 0 },
};

export function layers(config: BlitzConfig, backendName: string | null): Layer[] {
  const gov = config.governance;
  return [
    {
      key: "input",
      name: "Input gate",
      mode: gov.enabled ? "enforce" : "off",
      detail: "prompt injection / model whitelist checked before a turn starts",
      configured: ".blitz/blitz.config.yaml governance.*",
    },
    {
      key: "governance",
      name: "Per-call governance",
      mode: gov.enabled ? gov.mode : "off",
      detail: `provider ${gov.provider}; every model call is checked and audited${gov.mode === "enforce" ? "; a denied call is stopped (the run is aborted before the request is sent)" : "; denials are shown and audited, the call still goes out"}`,
      configured: ".blitz/blitz.config.yaml governance.mode (enforce | monitor), governance.provider",
    },
    {
      key: "profiles",
      name: "Access profiles",
      mode: "enforce",
      detail: `profile "${config.profiles.default}" decides which tools may run`,
      configured: ".blitz/profiles/<name>.yaml",
    },
    {
      key: "sandbox",
      name: "File sandbox",
      mode: config.sandbox.enabled ? "enforce" : "off",
      detail: "read/write/edit/grep/find/ls gated by zones (project silent; outside asks; system writes dangerous)",
      configured: ".blitz/blitz.config.yaml sandbox.enabled",
    },
    {
      key: "bash",
      name: "Bash sandbox",
      mode: config.sandbox.enabled ? (backendName && backendName !== "pinned" ? "enforce" : "monitor") : "off",
      detail: backendName ? `backend ${backendName}${backendName === "pinned" ? " (scope guard only — not OS-isolated)" : " (OS-isolated: writes confined to the workspace + /tmp)"}` : "no backend",
      configured: ".blitz/blitz.config.yaml sandbox.backend",
    },
    {
      key: "threat",
      name: "Threat detection",
      mode: config.threat_detection.enabled ? "enforce" : "off",
      detail: `tier ${config.threat_detection.tier}; scans commands/paths/urls of tool calls (never file content)`,
      configured: ".blitz/blitz.config.yaml threat_detection.*",
    },
    {
      key: "content",
      name: "Content injection scan",
      mode: config.threat_detection.content === "off" ? "off" : "monitor",
      detail: "every tool result the agent reads is scanned for instruction-shaped text; a hit is audited, shown, and the result is annotated so the model treats it as data — never blocked (files legitimately contain such phrases)",
      configured: ".blitz/blitz.config.yaml threat_detection.content (monitor | off)",
    },
    {
      key: "feeds",
      name: "Package feed (OSV)",
      mode: config.feeds.packages,
      detail: `every package an install command names is checked against osv.dev before it runs; a known-malicious package (an OSV MAL id) ${config.feeds.packages === "enforce" ? "is blocked" : "is recorded and shown"}; an unreachable feed never blocks`,
      configured: ".blitz/blitz.config.yaml feeds.packages (enforce | monitor | off)",
    },
    {
      key: "secrets",
      name: "Secrets feed (gitleaks)",
      mode: config.feeds.secrets === "off" ? "off" : secretsFeedInstalled() ? config.feeds.secrets : "off",
      detail: config.feeds.secrets !== "off" && !secretsFeedInstalled()
        ? `not installed — security feeds are opt-in: blitzpi feeds opt-in (then ${config.feeds.secrets} as configured)`
        : `a credential literal in a shell command ${config.feeds.secrets === "enforce" ? "is blocked" : "is recorded and shown"}; the secret is never written to the audit trail`,
      configured: ".blitz/blitz.config.yaml feeds.secrets (enforce | monitor | off) · blitzpi feeds update",
    },
    {
      key: "commands",
      name: "Command shapes (Sigma)",
      mode: config.feeds.commands === "off" ? "off" : feedInstalled("commands") ? config.feeds.commands : "off",
      detail: config.feeds.commands !== "off" && !feedInstalled("commands")
        ? `not installed — security feeds are opt-in: blitzpi feeds opt-in (then ${config.feeds.commands} as configured)`
        : `Linux/macOS process-creation rules (reverse shells, download-and-execute, persistence …) ${config.feeds.commands === "enforce" ? "block" : "are recorded and shown — read the false-positive rate off blitzpi report before enforce"}`,
      configured: ".blitz/blitz.config.yaml feeds.commands (enforce | monitor | off) · blitzpi feeds update",
    },
    {
      key: "urls",
      name: "Malicious URLs (URLhaus)",
      mode: config.feeds.urls === "off" ? "off" : feedInstalled("urls") ? config.feeds.urls : "off",
      detail: config.feeds.urls !== "off" && !feedInstalled("urls")
        ? `not installed — security feeds are opt-in: blitzpi feeds opt-in (then ${config.feeds.urls} as configured)`
        : `a URL in a command that URLhaus lists as distributing malware ${config.feeds.urls === "enforce" ? "is blocked before the command runs" : "is recorded and shown"}; shared platforms (GitHub, Drive …) match by exact URL only`,
      configured: ".blitz/blitz.config.yaml feeds.urls (enforce | monitor | off) · blitzpi feeds update",
    },
    {
      key: "audit",
      name: "Audit trail",
      mode: config.audit.enabled ? "enforce" : "off",
      detail: `every decision → ${config.audit.path}`,
      configured: ".blitz/blitz.config.yaml audit.*",
    },
  ];
}

const short: Record<string, string> = { input: "input", governance: "governance", profiles: "profile", sandbox: "files", bash: "bash", threat: "threat", content: "content", feeds: "packages", secrets: "secrets", commands: "commands", urls: "urls", audit: "audit" };

/** One row for the startup banner: `governance local (monitor) · bash bwrap (enforce) · …` */
export function summaryLine(config: BlitzConfig, backendName: string | null): string {
  return layers(config, backendName)
    .filter((l) => l.key !== "input")
    .map((l) => {
      const what = l.key === "governance" ? config.governance.provider : l.key === "bash" ? backendName ?? "none" : l.key === "profiles" ? config.profiles.default : l.key === "threat" ? `tier ${config.threat_detection.tier}` : l.key === "feeds" ? "osv" : l.key === "secrets" ? "gitleaks" : l.key === "commands" ? "sigma" : l.key === "urls" ? "urlhaus" : "";
      return `${short[l.key]}${what ? " " + what : ""} (${l.mode})`;
    })
    .join(" · ");
}

/** Steady status-bar text. Only changes on an event (denial / unreachable). */
export function governanceStatus(config: BlitzConfig): string {
  const g = stats.governance;
  const b = stats.blocked;
  const blocked = b.profile + b.sandbox + b.bash + b.threat + b.input + b.feed;
  const tail = blocked > 0 ? ` · ${blocked} blocked → /blitz-security` : "";
  if (!config.governance.enabled) return `🛡 governance off${tail}`;
  if (g.lastDenial) return `🛡 ${config.governance.mode === "enforce" ? "STOPPED" : "DENIED"} — ${g.lastDenial}`;
  if (g.unreachable > 0 && g.checked === 0) return `🛡 governance ${config.governance.provider} unreachable${tail}`;
  return `🛡 ${config.governance.provider} · ${config.governance.mode}${tail}`;
}

/** Total blocked this session across every layer. */
export function blockedTotal(): number {
  const b = stats.blocked;
  return b.profile + b.sandbox + b.bash + b.threat + b.input + b.feed;
}

export function panel(config: BlitzConfig, backendName: string | null, lastAudit: string[], sessionFile?: string): string {
  const rows = layers(config, backendName).map((l) => `  ${l.mode === "enforce" ? "●" : l.mode === "monitor" ? "◐" : "○"} ${l.name.padEnd(20)} ${l.mode.padEnd(8)} ${l.detail}\n      ${l.configured}`);
  const g = stats.governance;
  const b = stats.blocked;
  return [
    "BlitzPi security — this session",
    "  ● enforce = the runtime blocks   ◐ monitor = recorded and shown, not blocked   ○ off",
    "",
    ...rows,
    "",
    `  Model calls checked: ${g.checked}   denied (shown): ${g.denied}   provider unreachable: ${g.unreachable}`,
    `  Blocked: tools by profile ${b.profile} · file ops ${b.sandbox} · bash ${b.bash} · threat ${b.threat} · prompts ${b.input} · packages ${b.feed}`,
    `  Package feed: ${stats.feeds.checked} checked · ${stats.feeds.malicious} malicious · ${stats.feeds.unreachable} unreachable${stats.feeds.last ? `   last: ${stats.feeds.last.slice(0, 90)}` : ""}   Secrets feed: ${stats.feeds.secrets} credential(s) seen   Command shapes: ${stats.feeds.commands} hit(s)   URLs: ${stats.feeds.urls} listed`,
    `  Content scan: ${stats.content.scanned} results scanned · ${stats.content.flagged} with instruction-shaped text`,
    "",
    lastAudit.length ? "  Last decisions:" : "  No audit entries yet.",
    ...lastAudit.map((l) => `    ${l}`),
    "",
    "  Inspect: /blitz-security files | bash | governance | all   ·   this project: /blitz-report   ·   usage: /session",
    ...(sessionFile ? [`  This session's audit file: ${sessionFile}`] : []),
    "  Shell: blitzpi audit --help · blitzpi report · blitzpi projects   ·   Zones & ladder: docs/SECURITY-ZONES.md in the BlitzPi repo",
  ].join("\n");
}
