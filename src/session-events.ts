/**
 * This session's security decisions, kept in memory so `/blitz-security <files|bash|governance|all>` can show
 * WHAT the counters count (which files, which commands, which denials) — the audit trail has the same facts
 * on disk, this is the live, inspectable view. Bounded ring; oldest entries drop.
 */
export type EventKind = "file" | "bash" | "governance" | "profile" | "threat" | "compaction" | "feed" | "other";

export interface SessionEvent {
  time: string; // ISO
  kind: EventKind;
  label: string; // what: path, command, model, tool
  allowed: boolean; // false = blocked/denied
  detail: string; // zone / reason / backend
}

const MAX = 500;
const events: SessionEvent[] = [];

export function classify(entry: Record<string, unknown>): SessionEvent | null {
  const type = String(entry.type ?? "");
  const time = String(entry.timestamp ?? new Date().toISOString());
  const s = (v: unknown, n = 160) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);
  switch (type) {
    case "file_operation":
      return { time, kind: "file", label: `${entry.tool} ${s(entry.requested_path)}`, allowed: entry.allowed !== false, detail: s(`${entry.zone ?? ""} ${entry.reason ?? ""}`.trim()) };
    case "bash_exec": {
      const extra: string[] = [];
      if (Array.isArray(entry.deletes) && entry.deletes.length) extra.push(`rm: ${entry.deletes.join(", ")}`);
      if (Array.isArray(entry.urls) && entry.urls.length) extra.push(`url: ${entry.urls.join(", ")}`);
      return { time, kind: "bash", label: s(entry.command, 120), allowed: true, detail: s([entry.confined ? `confined (${entry.backend})` : "unconfined", ...extra].join(" · "), 200) };
    }
    case "governance_check":
      if (entry.stage === "input") return { time, kind: "governance", label: `prompt → ${s(entry.model, 40)}`, allowed: entry.approved !== false, detail: s(entry.reason) };
      if (entry.approved === false) return { time, kind: "governance", label: `model call ${s(entry.model, 40)}`, allowed: false, detail: s(`${entry.enforced ? "STOPPED" : "denied (monitor)"}: ${entry.reason ?? ""}`) };
      return null; // approved per-call checks are the common case — counted, not listed
    case "provider_auth_error":
      return { time, kind: "governance", label: `provider ${s(entry.status)}`, allowed: false, detail: "credentials rejected" };
    case "access_profile_check":
      return entry.allowed === false ? { time, kind: "profile", label: s(entry.tool_name ?? entry.tool), allowed: false, detail: s(entry.reason) } : null;
    case "threat_detection_check":
    case "threat_detected":
      return entry.allowed === false ? { time, kind: "threat", label: s(entry.tool_name ?? entry.tool), allowed: false, detail: s(entry.reason ?? entry.threat_category) } : null;
    case "feed_check": {
      const mal = (entry.malicious as string[] | undefined) ?? [];
      if (!mal.length) return null; // clean installs are counted, not listed
      return { time, kind: "feed", label: mal.join(", "), allowed: entry.allowed !== false, detail: s(`malicious package (${entry.mode}) — ${entry.command ?? ""}`) };
    }
    case "feed_unreachable":
      return { time, kind: "feed", label: s((entry.packages as string[] | undefined)?.join(", ")), allowed: true, detail: s(`feed unreachable, installed unchecked: ${entry.error ?? ""}`) };
    case "compaction":
      return { time, kind: "compaction", label: `compacted (${s(entry.reason)})`, allowed: true, detail: s(`${(entry.read_files as string[] | undefined)?.length ?? 0} read, ${(entry.modified_files as string[] | undefined)?.length ?? 0} modified summarised`) };
    default:
      return null;
  }
}

/** Called by the audit logger for every entry; keeps the ones worth showing. */
export function recordSessionEvent(entry: Record<string, unknown>): void {
  const e = classify(entry);
  if (!e) return;
  events.push(e);
  if (events.length > MAX) events.splice(0, events.length - MAX);
}

export function sessionEvents(kind?: EventKind | "all"): SessionEvent[] {
  return !kind || kind === "all" ? [...events] : events.filter((e) => e.kind === kind);
}

export function clearSessionEvents(): void { events.length = 0; }

/** Files this session touched through the file tools, grouped: read / written (write+edit) / blocked. */
export function fileSummary(): { read: string[]; written: string[]; blocked: string[] } {
  const read = new Set<string>(), written = new Set<string>(), blocked = new Set<string>();
  for (const e of events) {
    if (e.kind !== "file") continue;
    const sp = e.label.indexOf(" ");
    const tool = e.label.slice(0, sp), p = e.label.slice(sp + 1);
    if (!e.allowed) blocked.add(p);
    else if (tool === "write" || tool === "edit") written.add(p);
    else read.add(p);
  }
  return { read: [...read].sort(), written: [...written].sort(), blocked: [...blocked].sort() };
}

/** Text for `/blitz-security <kind>`. */
export function renderEvents(kind: EventKind | "all", limit = 40): string {
  const list = sessionEvents(kind).slice(-limit).reverse();
  const head = kind === "all" ? "This session's decisions" : `This session — ${kind}`;
  if (!list.length) return `${head}\n  (nothing recorded yet)`;
  const rows = list.map((e) => `  ${e.time.slice(11, 19)} ${e.allowed ? "✓" : "✗"} ${e.kind.padEnd(10)} ${e.label}${e.detail ? "  — " + e.detail : ""}`);
  const lines = [head, ...rows];
  if (kind === "all" || kind === "file") {
    const f = fileSummary();
    lines.push("", `  Files: ${f.read.length} read · ${f.written.length} written · ${f.blocked.length} blocked`);
    if (f.written.length) lines.push(`    written: ${f.written.join(", ")}`);
    if (f.blocked.length) lines.push(`    blocked: ${f.blocked.join(", ")}`);
  }
  return lines.join("\n");
}
