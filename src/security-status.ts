/**
 * One vocabulary for every security layer — `enforce` (the runtime blocks), `monitor` (recorded + shown, not
 * blocked), `off` — plus per-session counters. Everything user-facing (banner, status bar, /blitz-security)
 * derives from here, so the story is consistent and nothing is hard-coded prose.
 */
import type { BlitzConfig } from "./config";

export type Mode = "enforce" | "monitor" | "off";
export interface Layer { key: string; name: string; mode: Mode; detail: string; configured: string }

export const stats = {
  governance: { checked: 0, denied: 0, unreachable: 0, lastDenial: "" },
  blocked: { profile: 0, sandbox: 0, bash: 0, threat: 0, input: 0 },
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
      mode: gov.enabled ? "monitor" : "off",
      detail: `provider ${gov.provider}; every model call is checked and audited — Pi's hook cannot block a call, so denials are shown, not enforced (provider wrapper pending)`,
      configured: ".blitz/blitz.config.yaml governance.provider",
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
      key: "audit",
      name: "Audit trail",
      mode: config.audit.enabled ? "enforce" : "off",
      detail: `every decision → ${config.audit.path}`,
      configured: ".blitz/blitz.config.yaml audit.*",
    },
  ];
}

const short: Record<string, string> = { input: "input", governance: "governance", profiles: "profile", sandbox: "files", bash: "bash", threat: "threat", audit: "audit" };

/** One row for the startup banner: `governance local (monitor) · bash bwrap (enforce) · …` */
export function summaryLine(config: BlitzConfig, backendName: string | null): string {
  return layers(config, backendName)
    .filter((l) => l.key !== "input")
    .map((l) => {
      const what = l.key === "governance" ? config.governance.provider : l.key === "bash" ? backendName ?? "none" : l.key === "profiles" ? config.profiles.default : l.key === "threat" ? `tier ${config.threat_detection.tier}` : "";
      return `${short[l.key]}${what ? " " + what : ""} (${l.mode})`;
    })
    .join(" · ");
}

/** Steady status-bar text. Only changes on an event (denial / unreachable). */
export function governanceStatus(config: BlitzConfig): string {
  const g = stats.governance;
  if (!config.governance.enabled) return "🛡 governance off";
  if (g.lastDenial) return `🛡 DENIED — ${g.lastDenial}`;
  if (g.unreachable > 0 && g.checked === 0) return `🛡 governance ${config.governance.provider} unreachable`;
  return `🛡 ${config.governance.provider} · monitor`;
}

export function panel(config: BlitzConfig, backendName: string | null, lastAudit: string[]): string {
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
    `  Blocked: tools by profile ${b.profile} · file ops ${b.sandbox} · bash ${b.bash} · threat ${b.threat} · prompts ${b.input}`,
    "",
    lastAudit.length ? "  Last decisions:" : "  No audit entries yet.",
    ...lastAudit.map((l) => `    ${l}`),
    "",
    "  Shell: blitzpi audit --help   ·   Zones & ladder: docs/SECURITY-ZONES.md in the BlitzPi repo",
  ].join("\n");
}
