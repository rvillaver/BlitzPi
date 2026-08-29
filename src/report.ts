/**
 * Per-project diagnostics: what happened in a project across sessions, from two sources that already exist —
 *   ~/.blitz/audit/*.jsonl            every security decision (caller.project_path says which project)
 *   ~/.pi/agent/sessions/<slug>/*.jsonl  Pi's own session log (usage on every assistant message)
 * Nothing is collected specially for this; the report is a fold over what BlitzPi and Pi already write.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { queryAudit, type AuditEntry } from "./audit";
import { bashFacts } from "./bash-facts";

export interface ProjectReport {
  project: string;
  since?: string;
  sessions: { count: number; first?: string; last?: string; messages: number; tool_calls: number; tokens: { input: number; output: number; cache_read: number; cache_write: number }; cost: number; models: Record<string, number> };
  files: { read: string[]; written: string[]; blocked: string[]; deleted: string[] };
  bash: { commands: number; confined: number; unconfined: number; blocked: number };
  urls: string[];
  governance: { checked: number; denied: number; stopped: number; unreachable: number; denials: { time: string; model: string; reason: string }[] };
  threats: number;
  profile_blocks: number;
  compactions: number;
  audit_entries: number;
}

/** Pi's session directory for a cwd (mirrors getDefaultSessionDirPath in @earendil-works/pi-coding-agent). */
export function piSessionDir(cwd: string, agentDir = path.join(process.env.HOME || os.homedir(), ".pi", "agent")): string {
  const safe = `--${path.resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(agentDir, "sessions", safe);
}

function readJsonl(file: string): any[] {
  const out: any[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

export function sessionStats(cwd: string, since?: string, agentDir?: string): ProjectReport["sessions"] {
  const s: ProjectReport["sessions"] = { count: 0, messages: 0, tool_calls: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cost: 0, models: {} };
  const dir = piSessionDir(cwd, agentDir);
  if (!fs.existsSync(dir)) return s;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
    const entries = readJsonl(path.join(dir, f));
    const header = entries.find((e) => e.type === "session");
    if (!header) continue;
    if (path.resolve(header.cwd ?? cwd) !== path.resolve(cwd)) continue;
    if (since && header.timestamp < since) continue;
    s.count++;
    s.first = s.first && s.first < header.timestamp ? s.first : header.timestamp;
    s.last = s.last && s.last > header.timestamp ? s.last : header.timestamp;
    let model = "unknown";
    for (const e of entries) {
      if (e.type === "model_change") model = `${e.provider}/${e.modelId}`;
      const u = e.type === "message" ? e.message?.usage : e.type === "compaction" || e.type === "branch_summary" ? e.usage : undefined;
      if (e.type === "message") {
        s.messages++;
        if (e.message?.role === "assistant" && Array.isArray(e.message.content)) s.tool_calls += e.message.content.filter((c: any) => c.type === "toolCall").length;
      }
      if (!u) continue;
      s.tokens.input += u.input ?? 0; s.tokens.output += u.output ?? 0; s.tokens.cache_read += u.cacheRead ?? 0; s.tokens.cache_write += u.cacheWrite ?? 0;
      const cost = typeof u.cost === "number" ? u.cost : u.cost?.total ?? 0;
      s.cost += cost;
      if (e.type === "message" && e.message?.role === "assistant") {
        const key = e.message.model ? `${e.message.provider ? e.message.provider + "/" : ""}${e.message.model}` : model;
        s.models[key] = (s.models[key] ?? 0) + 1;
      }
    }
  }
  return s;
}

export function buildReport(project: string, opts: { since?: string; auditPath?: string; agentDir?: string } = {}): ProjectReport {
  const proj = path.resolve(project);
  const auditPath = opts.auditPath ?? path.join(process.env.HOME || os.homedir(), ".blitz", "audit");
  const entries = queryAudit(auditPath, opts.since ? { start_time: opts.since } : undefined).filter((e) => e.caller?.project_path && path.resolve(e.caller.project_path) === proj);
  const r: ProjectReport = {
    project: proj, since: opts.since,
    sessions: sessionStats(proj, opts.since, opts.agentDir),
    files: { read: [], written: [], blocked: [], deleted: [] },
    bash: { commands: 0, confined: 0, unconfined: 0, blocked: 0 },
    urls: [],
    governance: { checked: 0, denied: 0, stopped: 0, unreachable: 0, denials: [] },
    threats: 0, profile_blocks: 0, compactions: 0, audit_entries: entries.length,
  };
  const read = new Set<string>(), written = new Set<string>(), blocked = new Set<string>(), deleted = new Set<string>(), urls = new Set<string>();
  for (const e of entries as (AuditEntry & Record<string, any>)[]) {
    switch (e.type) {
      case "file_operation": {
        const p = String(e.requested_path ?? "");
        if (e.allowed === false) blocked.add(p);
        else if (e.tool === "write" || e.tool === "edit") written.add(p);
        else read.add(p);
        break;
      }
      case "bash_exec":
        r.bash.commands++;
        if (e.confined) r.bash.confined++; else r.bash.unconfined++;
        { // entries written before 1.2.0 carry only the command — derive the facts the same way
          const facts = e.deletes || e.urls ? { deletes: e.deletes ?? [], urls: e.urls ?? [] } : bashFacts(String(e.command ?? ""));
          for (const d of facts.deletes) deleted.add(String(d));
          for (const u of facts.urls) urls.add(String(u));
        }
        break;
      case "permission_check":
        if (e.allowed === false && e.tool === "bash command") r.bash.blocked++;
        break;
      case "governance_check":
        r.governance.checked++;
        if (e.approved === false) {
          r.governance.denied++;
          if (e.enforced) r.governance.stopped++;
          r.governance.denials.push({ time: e.timestamp, model: String(e.model ?? ""), reason: String(e.reason ?? "") });
        }
        if (e.threat_category === "api_error") r.governance.unreachable++;
        break;
      case "threat_detection_check": case "threat_detected":
        if (e.allowed === false) r.threats++;
        break;
      case "access_profile_check":
        if (e.allowed === false) r.profile_blocks++;
        break;
      case "compaction":
        r.compactions++;
        for (const p of e.read_files ?? []) read.add(String(p));
        for (const p of e.modified_files ?? []) written.add(String(p));
        break;
    }
  }
  r.files = { read: [...read].sort(), written: [...written].sort(), blocked: [...blocked].sort(), deleted: [...deleted].sort() };
  r.urls = [...urls].sort();
  return r;
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const list = (title: string, items: string[], max = 25) => items.length ? [`  ${title} (${items.length}):`, ...items.slice(0, max).map((i) => `    ${i}`), ...(items.length > max ? [`    … ${items.length - max} more`] : [])] : [`  ${title}: none`];

export function renderReport(r: ProjectReport): string {
  const s = r.sessions;
  const models = Object.entries(s.models).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ×${n}`).join(", ");
  return [
    `BlitzPi report — ${r.project}${r.since ? ` (since ${r.since})` : ""}`,
    "",
    `  Sessions: ${s.count}${s.first ? `  ${s.first.slice(0, 10)} → ${s.last?.slice(0, 10)}` : ""}   messages ${s.messages}   tool calls ${s.tool_calls}`,
    `  Tokens: ↑${k(s.tokens.input + s.tokens.cache_read + s.tokens.cache_write)} (cached ${k(s.tokens.cache_read)}) ↓${k(s.tokens.output)}   cost ~$${s.cost.toFixed(3)}${models ? `   models: ${models}` : ""}`,
    `  Security decisions audited: ${r.audit_entries}`,
    "",
    `  Model calls: ${r.governance.checked} checked · ${r.governance.denied} denied · ${r.governance.stopped} stopped · ${r.governance.unreachable} provider unreachable`,
    ...r.governance.denials.slice(-5).map((d) => `    ${d.time.slice(0, 19)} ${d.model}: ${d.reason}`),
    `  Bash: ${r.bash.commands} commands (${r.bash.confined} confined, ${r.bash.unconfined} unconfined) · ${r.bash.blocked} blocked   threats blocked ${r.threats} · tools blocked by profile ${r.profile_blocks} · compactions ${r.compactions}`,
    "",
    ...list("Files written", r.files.written),
    ...list("Files read", r.files.read, 15),
    ...list("Files blocked", r.files.blocked),
    ...list("Deleted (from bash command lines, best-effort)", r.files.deleted),
    ...list("URLs (from bash command lines, best-effort)", r.urls),
    "",
    "  Sources: ~/.blitz/audit (security decisions) · ~/.pi/agent/sessions (usage). Detail: blitzpi audit --project <path>",
  ].join("\n");
}
