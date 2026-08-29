import fs from "fs";
import path from "path";
import { queryAudit, AuditFilter } from "./audit";
import { listProjects, pruneProjects, forgetProject, renderProjects } from "./projects";
import { buildReport, renderReport } from "./report";

/**
 * R3.2: CLI command for querying audit trail
 */
export async function handleAuditCommand(args: string[]): Promise<void> {
  // Parse arguments: blitz audit --filter-type threat_detected --format json
  const options = parseAuditArgs(args);

  // Determine audit path
  const auditPath =
    options.audit_path ||
    path.join(process.env.HOME || process.cwd(), ".blitz", "audit");

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
