/**
 * Install-time policy for Bun projects, applied inside the sandbox without touching the project:
 *   - `minimumReleaseAge` (feeds.min_release_age, default 3d): a BlitzPi-owned `.bunfig.toml` is handed to every
 *     sandboxed command through XDG_CONFIG_HOME (Bun reads `$XDG_CONFIG_HOME/.bunfig.toml`; HOME is pinned to the
 *     workspace, so the user's own global config is out of reach anyway). Versions published more recently than
 *     the age are not selected — the "malicious version published an hour ago" window.
 *   - after a Bun install command, `bun pm untrusted` (packages whose lifecycle scripts Bun refused to run) and
 *     `bun audit --json` (advisories on the installed tree) run in the same sandbox; the summary is appended to the
 *     tool output so the agent and the user both see it, and audited as `install_policy`.
 * Bun already denies lifecycle scripts of untrusted packages; this layer makes that visible instead of silent.
 */
import fs from "node:fs";
import path from "node:path";

/** "3d" | "12h" | "45m" | "90s" | "off" → seconds (0 = off). */
export function parseAge(v: string | number | undefined, fallback = 3 * 86400): number {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number") return Math.max(0, Math.floor(v));
  const s = String(v).trim().toLowerCase();
  if (s === "off" || s === "0" || s === "none") return 0;
  const m = /^(\d+(?:\.\d+)?)\s*([smhdw]?)$/.exec(s);
  if (!m) return fallback;
  const n = Number(m[1]);
  const unit = { "": 1, s: 1, m: 60, h: 3600, d: 86400, w: 7 * 86400 }[m[2]] ?? 1;
  return Math.floor(n * unit);
}

export function bunfigFor(minimumReleaseAge: number): string {
  return `# Written by BlitzPi — the install policy every sandboxed command sees (feeds.min_release_age in .blitz/blitz.config.yaml).\n[install]\nminimumReleaseAge = ${minimumReleaseAge}\n`;
}

/** Ensure `<root>/.bunfig.toml` carries the policy; returns the directory to expose as XDG_CONFIG_HOME, or null when off. */
export function ensureSandboxConfig(root: string, minimumReleaseAge: number): string | null {
  if (minimumReleaseAge <= 0) return null;
  const file = path.join(root, ".bunfig.toml");
  const want = bunfigFor(minimumReleaseAge);
  try {
    fs.mkdirSync(root, { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf-8") !== want) fs.writeFileSync(file, want);
    return root;
  } catch { return null; }
}

/** A command that installs packages with Bun (the post-install checks apply). */
export function isBunInstall(command: string): boolean {
  // statement by statement, leading `VAR=value` assignments allowed: `TMPDIR=/x bun add …`, `cd a && bun i`
  return command.split(/;|&&|\|\||\||\n|\(/).some((seg) => /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*bun\s+(?:add|install|i|update|remove|rm|uninstall)\b/.test(seg));
}

/** `bun pm untrusted` → package names whose scripts Bun refused (empty when "Found 0 …"). */
export function parseUntrusted(text: string): string[] {
  if (/Found 0 untrusted/i.test(text)) return [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    // `./node_modules/protobufjs @7.2.6` (bun 1.4 prints a space before the version)
    const m = /^\s*\.\/node_modules\/(@?[^\s@]+)\s*@/.exec(line);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)];
}

export interface AuditSummary { total: number; bySeverity: Record<string, number>; packages: string[] }
/** `bun audit --json` (npm audit's bulk format: { <package>: [ { severity, title, … } ] }) → counts. */
export function summarizeAudit(jsonText: string): AuditSummary | null {
  let data: unknown;
  try { data = JSON.parse(jsonText); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const bySeverity: Record<string, number> = {}; const packages: string[] = []; let total = 0;
  for (const [pkg, advisories] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(advisories) || !advisories.length) continue;
    packages.push(pkg);
    for (const a of advisories) { total++; const sev = String((a as { severity?: string }).severity ?? "unknown").toLowerCase(); bySeverity[sev] = (bySeverity[sev] ?? 0) + 1; }
  }
  return { total, bySeverity, packages };
}

/** One line for the tool output + notice. */
export function renderPolicy(untrusted: string[], audit: AuditSummary | null): string {
  const parts: string[] = [];
  if (untrusted.length) parts.push(`${untrusted.length} package(s) wanted to run install scripts and Bun did not run them: ${untrusted.join(", ")} — if you trust them: bun pm trust <name>`);
  if (audit && audit.total) {
    const sev = ["critical", "high", "moderate", "low"].filter((k) => audit.bySeverity[k]).map((k) => `${audit.bySeverity[k]} ${k}`).join(", ");
    parts.push(`${audit.total} advisor${audit.total === 1 ? "y" : "ies"} (${sev}) on ${audit.packages.length} package(s): ${audit.packages.slice(0, 6).join(", ")}${audit.packages.length > 6 ? "…" : ""} — bun audit for details`);
  }
  return parts.length ? `[Blitz] install policy: ${parts.join(" · ")}` : "";
}
