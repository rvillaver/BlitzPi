import fs from "fs";
import path from "path";
import { queryAudit, AuditFilter } from "./audit";

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

  // Build filter
  const filter: AuditFilter = {};
  if (options.type) filter.type = options.type;
  if (options.caller) filter.caller_user = options.caller;
  if (options.allowed !== undefined) filter.allowed = options.allowed;
  if (options.start) filter.start_time = options.start;
  if (options.end) filter.end_time = options.end;

  // Query audit
  const entries = queryAudit(auditPath, filter);

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
    const details = entry.reason || entry.tool || "";

    console.log(
      `${timestamp} | ${type} | ${caller} | ${allowed} | ${details.substring(0, 40)}`
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
    const details = (entry.reason || entry.tool || "").replace(/,/g, ";");

    console.log(`"${timestamp}","${type}","${caller}","${allowed}","${details}"`);
  }
}

function printAuditHelp(): void {
  console.log(`
Blitz Audit Query Tool

Usage: blitz audit [options]

Options:
  --type TYPE          Filter by entry type (threat_detected, file_operation, etc)
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
`);
}
