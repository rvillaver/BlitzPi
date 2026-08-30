import { getOnBehalfOf } from "./caller";
import fs from "fs";
import path from "path";
import { Caller } from "./caller";
import { BlitzConfig } from "./config";
import { recordSessionEvent } from "./session-events";

export interface AuditEntry {
  timestamp: string;
  caller: Caller;
  type: string;
  [key: string]: unknown;
}

export interface AuditLogger {
  log(entry: Record<string, unknown>): void;
  close(): Promise<void>;
  getPath(): string;
  /** This session's own .jsonl file. */
  getSessionFile(): string;
}

/**
 * R3.1: Audit logging system — per-user, per-project storage
 * Orchestrates logging from all checkpoint layers (threat detection, access profiles, governance, sandbox)
 */
export function setupAudit(caller: Caller, config: BlitzConfig): AuditLogger {
  const auditPath = config.audit.path;

  // Create audit directory if it doesn't exist
  if (!fs.existsSync(auditPath)) {
    fs.mkdirSync(auditPath, { recursive: true });
  }

  // Create session audit file: {timestamp}-{user}.jsonl
  const sessionFile = path.join(auditPath, `${Date.now()}-${caller.user}.jsonl`);
  const stream = fs.createWriteStream(sessionFile, { flags: "a" });

  return {
    log(entry: Record<string, unknown>): void {
      const logEntry = {
        timestamp: new Date().toISOString(),
        type: entry.type || "unknown",
        caller,
        ...(getOnBehalfOf() ? { on_behalf_of: getOnBehalfOf() } : {}),
        ...entry,
      };
      stream.write(JSON.stringify(logEntry) + "\n");
      recordSessionEvent(logEntry);
    },
    async close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
      });
    },
    getPath(): string {
      return auditPath;
    },
    getSessionFile(): string {
      return sessionFile;
    },
  };
}

/**
 * R3.2: Query and filter audit entries
 */
export interface AuditFilter {
  type?: string;
  caller_user?: string;
  allowed?: boolean;
  start_time?: string;
  end_time?: string;
}

export function queryAudit(auditPath: string, filter?: AuditFilter): AuditEntry[] {
  const results: AuditEntry[] = [];

  if (!fs.existsSync(auditPath)) {
    return results;
  }

  // Read all .jsonl files in audit directory
  const files = fs
    .readdirSync(auditPath)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .reverse(); // Most recent first

  for (const file of files) {
    const filePath = path.join(auditPath, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as AuditEntry;

        // Apply filters
        if (filter) {
          if (filter.type && entry.type !== filter.type) continue;
          if (filter.caller_user && entry.caller.user !== filter.caller_user) continue;
          if (filter.allowed !== undefined && (entry as any).allowed !== filter.allowed) continue;
          if (filter.start_time && entry.timestamp < filter.start_time) continue;
          if (filter.end_time && entry.timestamp > filter.end_time) continue;
        }

        results.push(entry);
      } catch (e) {
        // Skip malformed lines
      }
    }
  }

  return results;
}
