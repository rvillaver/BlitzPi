import fs from "fs";
import path from "path";
import { queryAudit, AuditFilter } from "./audit";
import { listProjects, pruneProjects, forgetProject, renderProjects } from "./projects";
import { buildReport, renderReport } from "./report";
import { parseInstalls, type PackageRef } from "./feeds/packages";
import { OsvClient, maliciousOf } from "./feeds/osv";
import { FeedStore, FEEDS, feedsDir } from "./feeds/store";
import { fmtBytes, progressText } from "./feeds/onboard";
import { scanSecrets } from "./feeds/secrets";
import { scanCommand } from "./feeds/commands";
import { scanUrls } from "./feeds/urls";
import { setupAudit } from "./audit";
import { initializeCaller } from "./caller";
import { loadConfig } from "./config";
import { realHome } from "./real-home";

/**
 * R3.2: CLI command for querying audit trail
 */
export async function handleAuditCommand(args: string[]): Promise<void> {
  // Parse arguments: blitz audit --filter-type threat_detected --format json
  const options = parseAuditArgs(args);

  // Determine audit path
  const auditPath =
    options.audit_path ||
    path.join(realHome(), ".blitz", "audit");

  if (!fs.existsSync(auditPath)) {
    console.log("[Blitz] No audit trail found at", auditPath);
    return;
  }

  if (options.prune) {
    const r = pruneAudit(auditPath, options.dry_run);
    console.log(`[Blitz] ${options.dry_run ? "would remove" : "removed"} ${r.empty.length} empty session files and ${r.dead.length} files whose project no longer exists (${r.kept} kept)`);
    for (const f of [...r.empty, ...r.dead]) console.log(`  ${f}`);
    return;
  }

  // Build filter
  const filter: AuditFilter = {};
  if (options.type) filter.type = options.type;
  if (options.caller) filter.caller_user = options.caller;
  if (options.allowed !== undefined) filter.allowed = options.allowed;
  if (options.start) filter.start_time = options.start;
  if (options.end) filter.end_time = options.end;

  // Query audit
  let entries = queryAudit(auditPath, filter);
  if (options.project) {
    const proj = path.resolve(options.project);
    entries = entries.filter((e) => e.caller?.project_path && path.resolve(e.caller.project_path) === proj);
  }

  if (entries.length === 0) {
    console.log("[Blitz] No audit entries found matching filters");
    return;
  }

  // Format output
  if (options.format === "json") {
    console.log(JSON.stringify(entries, null, 2));
  } else if (options.format === "csv") {
    printAuditCSV(entries);
  } else {
    printAuditTable(entries);
  }
}

interface AuditOptions {
  type?: string;
  project?: string;
  prune?: boolean;
  dry_run?: boolean;
  caller?: string;
  allowed?: boolean;
  start?: string;
  end?: string;
  format?: "json" | "csv" | "table";
  audit_path?: string;
}

function parseAuditArgs(args: string[]): AuditOptions {
  const options: AuditOptions = { format: "table" };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--type") {
      options.type = args[++i];
    } else if (arg === "--project") {
      options.project = args[++i] || process.cwd();
    } else if (arg === "--prune") {
      options.prune = true;
    } else if (arg === "--dry-run") {
      options.dry_run = true;
    } else if (arg === "--caller") {
      options.caller = args[++i];
    } else if (arg === "--allowed" && args[i + 1] === "true") {
      options.allowed = true;
      i++;
    } else if (arg === "--denied" && args[i + 1] === "true") {
      options.allowed = false;
      i++;
    } else if (arg === "--start") {
      options.start = args[++i];
    } else if (arg === "--end") {
      options.end = args[++i];
    } else if (arg === "--format") {
      options.format = (args[++i] as any) || "table";
    } else if (arg === "--audit-path") {
      options.audit_path = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printAuditHelp();
      process.exit(0);
    }
  }

  return options;
}

function printAuditTable(entries: any[]): void {
  // Simple table output
  console.log("\nAudit Trail:");
  console.log(
    "Timestamp              | Type                  | Caller    | Allowed | Details"
  );
  console.log(
    "-".repeat(100)
  );

  for (const entry of entries.slice(0, 50)) {
    // Limit to 50 rows
    const timestamp = entry.timestamp.substring(11, 19);
    const type = (entry.type || "").padEnd(21);
    const caller = (entry.caller?.user || "?").padEnd(9);
    const allowed = (entry.allowed === undefined ? "N/A" : entry.allowed ? "✓" : "✗").padEnd(7);
    const details = auditDetails(entry);

    console.log(
      `${timestamp} | ${type} | ${caller} | ${allowed} | ${details.substring(0, 60)}`
    );
  }

  console.log(
    `\nTotal entries: ${entries.length}`
  );
}

function printAuditCSV(entries: any[]): void {
  console.log("timestamp,type,caller_user,allowed,details");

  for (const entry of entries) {
    const timestamp = entry.timestamp;
    const type = entry.type || "";
    const caller = entry.caller?.user || "";
    const allowed = entry.allowed === undefined ? "" : entry.allowed ? "yes" : "no";
    const details = auditDetails(entry).replace(/,/g, ";");

    console.log(`"${timestamp}","${type}","${caller}","${allowed}","${details}"`);
  }
}

function printAuditHelp(): void {
  console.log(`
Blitz Audit Query Tool

Usage: blitz audit [options]

Options:
  --type TYPE          Filter by entry type (threat_detected, file_operation, bash_exec, governance_check, compaction, etc)
  --project PATH       Only entries recorded in this project (default: current directory when PATH is omitted)
  --prune [--dry-run]  Remove empty session files and files whose project directory no longer exists
  --caller USER        Filter by caller user
  --allowed true|false Filter by allowed/denied decisions
  --start TIME         Start time (ISO 8601 format)
  --end TIME           End time (ISO 8601 format)
  --format FORMAT      Output format: table (default), json, csv
  --audit-path PATH    Path to audit directory
  --help               Show this help message

Examples:
  blitz audit                                    # Show all entries (table format)
  blitz audit --type threat_detected --format json  # Show threats as JSON
  blitz audit --allowed false                   # Show all denied actions
  blitz audit --caller rvillaver --start 2026-08-28T00:00:00Z  # Filter by user and time
  blitz audit --project . --type file_operation  # What this project's sessions touched
  blitz audit --prune --dry-run                  # Housekeeping preview

Related:
  blitzpi report [PATH] [--since ISO] [--format json]   Per-project diagnostics (files, URLs, commands, governance, usage)
  blitzpi projects [prune | forget PATH]               Projects managed by BlitzPi
`);
}

/** One-line detail per entry type so the table says WHAT, not just the type. */
function auditDetails(entry: any): string {
  switch (entry.type) {
    case "file_operation": return `${entry.tool} ${entry.requested_path ?? ""}${entry.allowed === false ? " — " + (entry.reason ?? "") : ""}`;
    case "bash_exec": return `${entry.confined ? "confined" : "unconfined"}: ${String(entry.command ?? "").replace(/\s+/g, " ")}`;
    case "bash_exit": return `exit ${entry.exit_code} ${entry.ms ?? ""}ms`;
    case "governance_check": return `${entry.stage ?? "call"} ${entry.model ?? ""}${entry.approved === false ? " — " + (entry.reason ?? "") : ""}`;
    case "permission_check": return `${entry.action} ${entry.zone} ${entry.target ?? ""}`;
    case "compaction": return `${entry.reason}: ${(entry.read_files ?? []).length} read, ${(entry.modified_files ?? []).length} modified`;
    default: return entry.reason || entry.tool || entry.tool_name || "";
  }
}

/** Audit housekeeping: empty session files (headless probes) and files whose project is gone. */
export function pruneAudit(auditPath: string, dryRun = false): { empty: string[]; dead: string[]; kept: number } {
  const empty: string[] = [], dead: string[] = [];
  let kept = 0;
  for (const f of fs.readdirSync(auditPath).filter((f) => f.endsWith(".jsonl"))) {
    const file = path.join(auditPath, f);
    const content = fs.readFileSync(file, "utf-8");
    if (!content.trim()) { empty.push(f); continue; }
    let project: string | undefined;
    try { project = JSON.parse(content.split("\n").find((l) => l.trim())!).caller?.project_path; } catch { /* keep */ }
    if (project && !fs.existsSync(project)) { dead.push(f); continue; }
    kept++;
  }
  if (!dryRun) for (const f of [...empty, ...dead]) fs.unlinkSync(path.join(auditPath, f));
  return { empty, dead, kept };
}

export async function handleProjectsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === "prune") {
    const gone = pruneProjects();
    console.log(gone.length ? `[Blitz] Removed ${gone.length} project(s) from the registry:\n${gone.map((g) => `  ${g.path} (${!g.exists ? "missing" : "no .blitz"})`).join("\n")}` : "[Blitz] Nothing to prune.");
    return;
  }
  if (sub === "forget") {
    const p = args[1];
    if (!p) { console.log("Usage: blitzpi projects forget <path>"); return; }
    console.log(forgetProject(p) ? `[Blitz] Forgot ${path.resolve(p)}` : `[Blitz] Not registered: ${path.resolve(p)}`);
    return;
  }
  if (sub === "--help" || sub === "-h") {
    console.log("Usage: blitzpi projects [--format json]      list projects managed by BlitzPi\n       blitzpi projects prune               drop entries that are missing or no longer carry .blitz/\n       blitzpi projects forget <path>       drop one entry");
    return;
  }
  const list = listProjects();
  if (args.includes("--format") && args[args.indexOf("--format") + 1] === "json") console.log(JSON.stringify(list, null, 2));
  else console.log(renderProjects(list));
}

export async function handleReportCommand(args: string[]): Promise<void> {
  let project = process.cwd(), since: string | undefined, format = "text", auditPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--since") since = args[++i];
    else if (a === "--format") format = args[++i] ?? "text";
    else if (a === "--audit-path") auditPath = args[++i];
    else if (a === "--help" || a === "-h") { console.log("Usage: blitzpi report [PATH] [--since ISO-8601] [--format text|json] [--audit-path DIR]\n  Per-project diagnostics from ~/.blitz/audit (security decisions) and ~/.pi/agent/sessions (usage)."); return; }
    else if (!a.startsWith("-")) project = a;
  }
  const r = buildReport(project, { since, auditPath });
  console.log(format === "json" ? JSON.stringify(r, null, 2) : renderReport(r));
}

function cliAudit() { // the CLI's own audit session: feed updates/rollbacks are governance events too
  try { return setupAudit(initializeCaller(), loadConfig()); } catch { return undefined; }
}
const shortSha = (s?: string) => (s ? s.slice(0, 12) : "—");

export async function handleLevelCommand(args: string[]): Promise<void> {
  const { LEVELS, LEVEL_BLURB, describeSecurityLevel, setSecurityLevel } = await import("./security-level");
  const global = args.includes("--global");
  const value = args.find((a) => !a.startsWith("-"));
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: blitzpi level [strict|guarded|monitored] [--global]\n  No value: show the active tier and where it comes from. --global sets the machine-wide default (~/.blitz/blitz.config.yaml) instead of this project's.");
    return;
  }
  if (!value) {
    const { level, source } = describeSecurityLevel();
    console.log(`[Blitz] security level: ${level} (${source === "default" ? "built-in default — no config sets it" : `set in ${source} config`})`);
    for (const l of LEVELS) console.log(`  ${l === level ? "*" : " "} ${l.padEnd(10)} ${LEVEL_BLURB[l]}`);
    return;
  }
  if (!(LEVELS as string[]).includes(value)) { console.log(`[Blitz] unknown level "${value}" — one of: ${LEVELS.join(", ")}`); process.exitCode = 2; return; }
  const audit = cliAudit();
  const { from, file } = setSecurityLevel(value as (typeof LEVELS)[number], { global }, audit);
  await audit?.close();
  console.log(`[Blitz] security level: ${from} -> ${value} (${file})`);
}

export async function handleFeedsCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const client = new OsvClient();
  const store = new FeedStore();
  const version = (() => { try { return require(path.join(__dirname, "..", "package.json")).version as string; } catch { return undefined; } })();
  if (sub === "opt-in") {
    store.optIn();
    console.log("[Blitz] Security feeds: opted in. Installing…");
    args = ["update"];
  }
  if (sub === "status" || sub === undefined) {
    const d = store.decision();
    if (d === "out") console.log("[Blitz] Security feeds: declined (blitzpi feeds opt-in to change).");
    else if (!d) console.log("[Blitz] Security feeds: not decided yet — BlitzPi asks at the next start, or run: blitzpi feeds opt-in");
  }
  if (sub === "opt-out") {
    const removed = store.optOut(args.includes("--remove"));
    console.log(`[Blitz] Security feeds: opted out${removed.length ? `; removed ${removed.join(", ")}` : args.includes("--remove") ? "" : " (installed feeds kept on disk, inactive; add --remove to delete them)"}.`);
    return;
  }
  if (args[0] === "update") {
    if (!store.optedIn()) { console.log("[Blitz] Security feeds are opt-in and you have not opted in. Run: blitzpi feeds opt-in"); process.exitCode = 2; return; }
    const names = args.slice(1).filter((a) => !a.startsWith("-"));
    const force = args.includes("--force");
    const audit = cliAudit();
    let failed = 0;
    const tty = !!process.stdout.isTTY;
    for (const f of names.length ? names : FEEDS.map((x) => x.name)) {
      let lastLine = "";
      const ev = await store.update(f, { force, version, onProgress: (feed, received, total) => {
        if (!tty) return;
        const pct = total ? Math.min(100, Math.round((received / total) * 100)) : 0;
        const bar = total ? `${"▉".repeat(Math.round(pct / 10))}${"░".repeat(10 - Math.round(pct / 10))} ${String(pct).padStart(3)}%` : "…";
        const line = `  ${feed.padEnd(10)} ${bar}  ${fmtBytes(received)}${total ? ` / ${fmtBytes(total)}` : ""}`;
        if (line !== lastLine) { process.stdout.write(`\r${line.padEnd(70)}`); lastLine = line; }
      } });
      if (tty && lastLine) process.stdout.write("\r" + " ".repeat(72) + "\r");
      audit?.log(ev as any);
      if (ev.type === "feed_update") console.log(`  ${f.padEnd(10)} ${ev.changed ? "updated " : "unchanged"}  ${ev.rules} rules${ev.skipped ? ` (${ev.skipped} skipped)` : ""}  ${fmtBytes(ev.bytes)} downloaded → ${fmtBytes(ev.stored ?? 0)} stored  sha256 ${shortSha(ev.to)}${ev.changed && ev.from ? `  (was ${shortSha(ev.from)} — blitzpi feeds rollback ${f})` : ""}`);
      else if (ev.type === "feed_update_failed") { failed++; console.log(`  ${f.padEnd(10)} FAILED    ${ev.error}${ev.kept ? `  (previous feed ${shortSha(ev.kept)} kept)` : ""}`); }
    }
    await audit?.close();
    const sz = store.sizes();
    console.log(`  total on disk: ${fmtBytes(sz.total)} in ${feedsDir()} (current + previous copies${sz.cache ? `, OSV cache ${fmtBytes(sz.cache)}` : ""})`);
    if (failed) process.exitCode = 1;
    return;
  }
  if (sub === "rollback") {
    const f = args[1]; if (!f) { console.log("Usage: blitzpi feeds rollback <feed>"); return; }
    const audit = cliAudit(); const ev = store.rollback(f); audit?.log(ev as any); await audit?.close();
    console.log(ev.type === "feed_rollback" ? `  ${f}: rolled back ${shortSha(ev.from)} → ${shortSha(ev.to)} (run rollback again to return)` : `  ${f}: ${ev.type === "feed_update_failed" ? ev.error : "unexpected result"}`);
    if (ev.type !== "feed_rollback") process.exitCode = 1;
    return;
  }
  if (sub === "list") {
    console.log(`Security feeds (${store.optedIn() ? "opted in" : "NOT opted in — blitzpi feeds opt-in"}), ${feedsDir()}`);
    const sz = store.sizes();
    for (const f of store.list()) {
      const m = f.manifest; const z = sz.feeds.find((x) => x.name === f.name)!;
      console.log(`  ${f.name.padEnd(10)} ${f.installed ? "installed" : "absent   "}  ${m ? `${m.rules} rules${m.skipped ? ` (${m.skipped} skipped)` : ""}, fetched ${m.fetched_at.slice(0, 16)}Z, ${fmtBytes(m.bytes)} downloaded → ${fmtBytes(z.stored)} stored${z.previous ? ` (+ ${fmtBytes(z.previous)} previous)` : ""}, sha256 ${shortSha(m.sha256)}` : ""}\n             ${f.description}\n             source: ${FEEDS.find((d) => d.name === f.name)?.source}  (${FEEDS.find((d) => d.name === f.name)?.license})`);
    }
    console.log(`  total on disk: ${fmtBytes(sz.total)}${sz.cache ? ` (incl. OSV cache ${fmtBytes(sz.cache)})` : ""}`);
    return;
  }
  if (sub === "scan") {
    const text = args.slice(1).join(" ");
    const secrets = store.rules("secrets"), commands = store.rules("commands"), urls = store.rules("urls");
    if (!secrets && !commands && !urls) { console.log("[Blitz] no feeds installed (blitzpi feeds opt-in)"); process.exitCode = 2; return; }
    const lines: string[] = [];
    if (secrets) for (const h of scanSecrets(text, secrets)) lines.push(`  ✗ secret   ${h.id} [${h.severity}] ${h.sample} — ${h.description}`);
    if (commands) for (const h of scanCommand(text, commands)) lines.push(`  ✗ command  ${h.title} [${h.severity}] ${h.id}${h.tags?.length ? "  " + h.tags.join(" ") : ""}`);
    if (urls) for (const h of scanUrls(text, urls)) lines.push(`  ✗ url      ${h.url} — ${h.kind === "url" ? "listed URL" : `host ${h.host} listed ${h.listed}×`} (URLhaus)`);
    console.log(lines.length ? lines.join("\n") : `  ✓ nothing flagged (${[secrets && "secrets", commands && "commands", urls && "urls"].filter(Boolean).join(", ")})`);
    if (lines.length) process.exitCode = 3;
    return;
  }
  if (sub === "check") {
    const refs: PackageRef[] = [];
    for (const a of args.slice(1)) {
      const m = a.match(/^(npm|pypi|crates\.io|rubygems|go):(.+)$/i);
      const eco = (m ? { npm: "npm", pypi: "PyPI", "crates.io": "crates.io", rubygems: "RubyGems", go: "Go" }[m[1].toLowerCase()] : "npm") as PackageRef["ecosystem"];
      const name = m ? m[2] : a;
      refs.push(...(parseInstalls(`${eco === "PyPI" ? "pip install" : eco === "npm" ? "npm i" : eco === "crates.io" ? "cargo add" : eco === "RubyGems" ? "gem install" : "go get"} ${name}`).length ? [{ ecosystem: eco, name }] : []));
    }
    if (!refs.length) { console.log("Usage: blitzpi feeds check <package> [pypi:<package>] …   (default ecosystem: npm)"); return; }
    const r = await client.check(refs);
    if (r.unreachable) console.log(`[Blitz] OSV unreachable: ${r.error ?? "no response"}`);
    for (const v of r.verdicts) console.log(`  ${v.malicious.length ? "✗ MALICIOUS" : "✓ clean    "}  ${v.ecosystem}:${v.name}${v.malicious.length ? `  ${v.malicious.join(", ")}${v.summary ? " — " + v.summary : ""}` : ""}${v.cached ? "  (cached)" : ""}`);
    if (maliciousOf(r).length) process.exitCode = 3;
    return;
  }
  if (sub === "clear-cache") { client.clearCache(); console.log("[Blitz] OSV cache cleared."); return; }
  if (sub === "parse") { console.log(JSON.stringify(parseInstalls(args.slice(1).join(" ")))); return; }
  if (sub === "--help" || sub === "-h") {
    console.log("Usage: blitzpi feeds [status]            sources, opt-in state, cache\n       blitzpi feeds opt-in | opt-out [--remove]   security feeds are an opt-in download, separate from platform updates\n       blitzpi feeds update [feed…] [--force]      fetch + compile (previous version kept)\n       blitzpi feeds list                          installed feeds, rule counts, hashes\n       blitzpi feeds rollback <feed>               back to the previous version of a feed\n       blitzpi feeds scan <text>                   test the secrets rules against a string\n       blitzpi feeds check <pkg…>        ask OSV without installing (npm default; pypi:<name>, crates.io:<name>, rubygems:<name>, go:<path>)\n       blitzpi feeds parse <command>     which packages a shell command would install\n       blitzpi feeds clear-cache");
    return;
  }
  const c = client.cacheStats();
  const sec = store.manifest("secrets"); const cmd = store.manifest("commands"); const url = store.manifest("urls"); const sz = store.sizes();
  console.log(`Detection feeds\n  packages   OSV (osv.dev) — queried per install command, nothing to install; known-malicious (MAL ids) blocks under feeds.packages: enforce\n             cache: ${c.entries} package(s), ${c.malicious} malicious, oldest ${c.oldest ?? "—"}  (${c.path})\n  secrets    gitleaks rules — ${store.optedIn() ? (sec ? `installed: ${sec.rules} rules, fetched ${sec.fetched_at.slice(0, 16)}Z, sha256 ${shortSha(sec.sha256)}` : "opted in but not downloaded yet: blitzpi feeds update") : store.decision() === "out" ? "declined" : "NOT opted in (blitzpi feeds opt-in) — security feeds are a separate, optional download"}\n  commands   Sigma rules — ${store.optedIn() ? (cmd ? `installed: ${cmd.rules} rules (${cmd.skipped} skipped), fetched ${cmd.fetched_at.slice(0, 16)}Z, sha256 ${shortSha(cmd.sha256)}` : "opted in but not downloaded yet: blitzpi feeds update") : "NOT opted in"}\n  urls       URLhaus — ${store.optedIn() ? (url ? `installed: ${url.rules} URLs, fetched ${url.fetched_at.slice(0, 16)}Z, sha256 ${shortSha(url.sha256)} (hourly source: blitzpi feeds update)` : "opted in but not downloaded yet: blitzpi feeds update") : "NOT opted in"}\n  on disk    ${fmtBytes(sz.total)} in ${feedsDir()}${sz.feeds.some((f) => f.previous) ? " (current + previous copies for rollback)" : ""}`);
}
