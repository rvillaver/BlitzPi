import fs from "fs"; import os from "os"; import path from "path";
process.env.BLITZ_FEEDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-nofeeds-")); // status must not depend on this machine's opt-in
import { extractDeletes, extractUrls, bashFacts } from "../src/bash-facts";
import { classify, recordSessionEvent, sessionEvents, clearSessionEvents, fileSummary, renderEvents } from "../src/session-events";
import { touchProject, listProjects, pruneProjects, forgetProject, renderProjects, loadRegistry } from "../src/projects";
import { buildReport, renderReport, piSessionDir, sessionStats } from "../src/report";
import { setupCompaction } from "../src/compaction";
import { governanceStatus, stats, panel } from "../src/security-status";
import { pruneAudit } from "../src/cli";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-diag-"));
const cfg: any = { threat_detection: { enabled: true, tier: 2, content: "monitor" }, audit: { enabled: true, path: "/h/.blitz/audit" }, profiles: { default: "user" }, sandbox: { enabled: true, run_dir: ".", backend: "auto" }, governance: { enabled: true, mode: "enforce", provider: "local" }, goodbehavior: { profile: "development" }, threat_api: { enabled: false }, feeds: { packages: "enforce", secrets: "monitor", commands: "monitor", urls: "monitor", cache_ttl_hours: 24 } };

describe("bash facts (what a command deletes / fetches, from its command line)", () => {
  test("rm variants, quoted paths, git rm, find -delete", () => {
    expect(extractDeletes("rm -rf build dist/ 'my file.txt'")).toEqual(["build", "dist/", "my file.txt"]);
    expect(extractDeletes("cd x && rm -f a.log; unlink b.tmp | cat")).toEqual(["a.log", "b.tmp"]);
    expect(extractDeletes("git rm --cached src/old.ts")).toEqual(["src/old.ts"]);
    expect(extractDeletes("find . -name '*.pyc' -delete")).toEqual(["find:."]);
    expect(extractDeletes("echo remove")).toEqual([]);
  });
  test("urls are deduped and trailing punctuation dropped", () => {
    expect(extractUrls("curl -s https://registry.npmjs.org/elysia, then wget http://localhost:3000/health.")).toEqual(["https://registry.npmjs.org/elysia", "http://localhost:3000/health"]);
    expect(extractUrls("curl https://a.b/x https://a.b/x")).toEqual(["https://a.b/x"]);
    expect(bashFacts("ls")).toEqual({ deletes: [], urls: [] });
  });
});

describe("bash guard: URLs are not paths", () => {
  test("a command that names a URL stays in-project (confined); real paths are still found", () => {
    const { extractTargets } = require("../src/bash-guard");
    expect(extractTargets("curl -sI https://example.com | head -1")).toEqual([]);
    expect(extractTargets("wget http://localhost:3000/x -O /tmp/out")).toEqual([{ path: "/tmp/out", write: true }]); // the download's output file is a write (backlog P0 #1)
    expect(extractTargets("cat /etc/hosts")).toEqual([{ path: "/etc/hosts", write: false }]);
  });
});

describe("session events (the inspectable view behind the counters)", () => {
  beforeEach(() => clearSessionEvents());
  test("keeps file ops, bash, denials and compactions; drops approved per-call governance checks", () => {
    const t = "2026-08-30T10:00:00.000Z";
    recordSessionEvent({ timestamp: t, type: "file_operation", tool: "read", requested_path: "src/a.ts", zone: "project", allowed: true, reason: "in-scope" });
    recordSessionEvent({ timestamp: t, type: "file_operation", tool: "edit", requested_path: "src/a.ts", zone: "project", allowed: true });
    recordSessionEvent({ timestamp: t, type: "file_operation", tool: "write", requested_path: "/etc/x", zone: "system", allowed: false, reason: "dangerous" });
    recordSessionEvent({ timestamp: t, type: "bash_exec", confined: true, backend: "bwrap", command: "rm -rf build && curl https://x.y/z", deletes: ["build"], urls: ["https://x.y/z"] });
    recordSessionEvent({ timestamp: t, type: "governance_check", stage: "provider_request", approved: true, model: "m" });
    recordSessionEvent({ timestamp: t, type: "governance_check", stage: "provider_request", approved: false, enforced: true, model: "m", reason: "policy" });
    recordSessionEvent({ timestamp: t, type: "compaction", reason: "threshold", read_files: ["a", "b"], modified_files: ["c"] });
    const kinds = sessionEvents().map((e) => e.kind);
    expect(kinds).toEqual(["file", "file", "file", "bash", "governance", "compaction"]);
    expect(sessionEvents("governance")[0]).toMatchObject({ allowed: false, detail: "STOPPED: policy" });
    expect(sessionEvents("bash")[0].detail).toBe("confined (bwrap) · rm: build · url: https://x.y/z");
    expect(fileSummary()).toEqual({ read: ["src/a.ts"], written: ["src/a.ts"], blocked: ["/etc/x"] });
    const out = renderEvents("all");
    expect(out).toContain("✗ file       write /etc/x  — system dangerous");
    expect(out).toContain("Files: 1 read · 1 written · 1 blocked");
    expect(renderEvents("threat")).toContain("(nothing recorded yet)");
    expect(classify({ type: "unknown_thing" })).toBeNull();
  });
  test("status bar advertises the drill-down once something was blocked", () => {
    const before = { ...stats.blocked };
    Object.assign(stats.blocked, { profile: 0, sandbox: 0, bash: 0, threat: 0, input: 0 });
    stats.governance.lastDenial = "";
    expect(governanceStatus(cfg)).toBe("🛡 local · enforce");
    stats.blocked.sandbox = 2; stats.blocked.bash = 1;
    expect(governanceStatus(cfg)).toBe("🛡 local · enforce · 3 blocked → /blitz-security");
    Object.assign(stats.blocked, before);
    expect(panel(cfg, "bwrap", [], "/h/.blitz/audit/1-u.jsonl")).toContain("This session's audit file: /h/.blitz/audit/1-u.jsonl");
    expect(panel(cfg, "bwrap", [])).toContain("/blitz-security files | bash | governance | all");
  });
});

describe("project registry (~/.blitz/projects.json)", () => {
  test("touch → list → prune → forget", () => {
    const home = tmp(); const reg = path.join(home, ".blitz", "projects.json");
    const live = path.join(home, "proj"); fs.mkdirSync(path.join(live, ".blitz"), { recursive: true });
    const gone = path.join(home, "gone");
    const noBlitz = path.join(home, "plain"); fs.mkdirSync(noBlitz);
    touchProject(live, { version: "1.2.0", profile: "development", session: true }, reg);
    touchProject(live, { session: true }, reg);
    touchProject(gone, { session: true }, reg);
    touchProject(noBlitz, {}, reg);
    const list = listProjects(reg);
    expect(list.map((p) => [p.path, p.exists, p.adopted, p.sessions])).toEqual(expect.arrayContaining([[live, true, true, 2], [gone, false, false, 1], [noBlitz, true, false, 0]]));
    expect(list.find((p) => p.path === live)).toMatchObject({ blitzpi_version: "1.2.0", profile: "development" });
    expect(renderProjects(list)).toContain("missing");
    expect(renderProjects(list)).toContain("no .blitz");
    expect(pruneProjects(reg).map((p) => p.path).sort()).toEqual([gone, noBlitz].sort());
    expect(Object.keys(loadRegistry(reg).projects)).toEqual([live]);
    expect(forgetProject(live, reg)).toBe(true);
    expect(forgetProject(live, reg)).toBe(false);
    expect(loadRegistry(reg).projects).toEqual({});
    expect(loadRegistry(path.join(home, "nope.json"))).toEqual({ version: 1, projects: {} });
  });
});

describe("per-project report (audit trail + Pi session logs)", () => {
  test("session dir slug matches Pi's", () => {
    expect(piSessionDir("/home/u/Work/app", "/h/.pi/agent")).toBe("/h/.pi/agent/sessions/--home-u-Work-app--");
  });
  test("folds files, deletes, urls, governance and usage for one project only", () => {
    const home = tmp(); const proj = path.join(home, "app"); const other = path.join(home, "other");
    fs.mkdirSync(proj); fs.mkdirSync(other);
    const auditPath = path.join(home, ".blitz", "audit"); fs.mkdirSync(auditPath, { recursive: true });
    const caller = (p: string) => ({ user: "u", install_type: "local", project_path: p });
    const lines = [
      { timestamp: "2026-08-30T10:00:00.000Z", type: "file_operation", caller: caller(proj), tool: "read", requested_path: "README.md", allowed: true },
      { timestamp: "2026-08-30T10:00:01.000Z", type: "file_operation", caller: caller(proj), tool: "write", requested_path: "src/x.ts", allowed: true },
      { timestamp: "2026-08-30T10:00:02.000Z", type: "file_operation", caller: caller(proj), tool: "write", requested_path: "/etc/passwd", allowed: false, reason: "system" },
      { timestamp: "2026-08-30T10:00:03.000Z", type: "bash_exec", caller: caller(proj), confined: true, command: "rm -rf dist && curl https://example.com/api", deletes: ["dist"], urls: ["https://example.com/api"] },
      { timestamp: "2026-08-30T10:00:04.000Z", type: "bash_exec", caller: caller(proj), confined: false, command: "ls" },
      { timestamp: "2026-08-30T10:00:05.000Z", type: "permission_check", caller: caller(proj), action: "write", zone: "other", target: "rm -rf /", allowed: false, via: "auto", tool: "bash command" },
      { timestamp: "2026-08-30T10:00:06.000Z", type: "governance_check", caller: caller(proj), stage: "provider_request", approved: true, model: "m" },
      { timestamp: "2026-08-30T10:00:07.000Z", type: "governance_check", caller: caller(proj), stage: "provider_request", approved: false, enforced: true, model: "m", reason: "policy" },
      { timestamp: "2026-08-30T10:00:08.000Z", type: "compaction", caller: caller(proj), reason: "threshold", read_files: ["docs/a.md"], modified_files: ["src/y.ts"] },
      { timestamp: "2026-08-30T10:00:09.000Z", type: "file_operation", caller: caller(other), tool: "write", requested_path: "NOT-MINE", allowed: true },
    ];
    fs.writeFileSync(path.join(auditPath, "1-u.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const agentDir = path.join(home, ".pi", "agent");
    const sdir = piSessionDir(proj, agentDir); fs.mkdirSync(sdir, { recursive: true });
    const usage = (i: number, o: number, cr = 0) => ({ input: i, output: o, cacheRead: cr, cacheWrite: 0, cost: { total: 0.01 } });
    const sess = [
      { type: "session", version: 3, id: "s1", timestamp: "2026-08-30T09:00:00.000Z", cwd: proj },
      { type: "model_change", provider: "anthropic", modelId: "claude-x" },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
      { type: "message", message: { role: "assistant", provider: "anthropic", model: "claude-x", content: [{ type: "toolCall" }, { type: "text" }], usage: usage(100, 10, 50) } },
      { type: "message", message: { role: "assistant", provider: "anthropic", model: "claude-x", content: [], usage: usage(200, 20) } },
      { type: "compaction", usage: usage(300, 30) },
    ];
    fs.writeFileSync(path.join(sdir, "a.jsonl"), sess.map((l) => JSON.stringify(l)).join("\n") + "\n");
    // a session file that belongs to a different cwd but landed in the same dir must not count
    fs.writeFileSync(path.join(sdir, "b.jsonl"), JSON.stringify({ type: "session", version: 3, id: "s2", timestamp: "2026-08-30T09:30:00.000Z", cwd: other }) + "\n");

    const r = buildReport(proj, { auditPath, agentDir });
    expect(r.audit_entries).toBe(9);
    expect(r.files).toEqual({ read: ["README.md", "docs/a.md"], written: ["src/x.ts", "src/y.ts"], blocked: ["/etc/passwd"], deleted: ["dist"] });
    expect(r.urls).toEqual(["https://example.com/api"]);
    expect(r.bash).toEqual({ commands: 2, confined: 1, unconfined: 1, blocked: 1 });
    expect(r.governance).toMatchObject({ checked: 2, denied: 1, stopped: 1, unreachable: 0 });
    expect(r.governance.denials[0].reason).toBe("policy");
    expect(r.compactions).toBe(1);
    expect(r.sessions).toMatchObject({ count: 1, messages: 3, tool_calls: 1, tokens: { input: 600, output: 60, cache_read: 50, cache_write: 0 }, models: { "anthropic/claude-x": 2 } });
    expect(r.sessions.cost).toBeCloseTo(0.03);
    const text = renderReport(r);
    for (const s of ["Sessions: 1", "Files written (2):", "src/x.ts", "Deleted (from bash command lines, best-effort) (1):", "dist", "URLs (from bash command lines, best-effort) (1):", "https://example.com/api", "1 denied · 1 stopped", "cost ~$0.030"]) expect(text).toContain(s);
    expect(text).not.toContain("NOT-MINE");
    // --since drops everything before the cut
    const later = buildReport(proj, { auditPath, agentDir, since: "2026-08-30T10:00:05.000Z" });
    expect(later.files.written).toEqual(["src/y.ts"]);
    expect(later.sessions.count).toBe(0);
    expect(sessionStats(path.join(home, "never"), undefined, agentDir).count).toBe(0);
  });
  test("audit prune removes empty files and files whose project is gone, keeps the rest", () => {
    const home = tmp(); const auditPath = path.join(home, "audit"); fs.mkdirSync(auditPath);
    const live = path.join(home, "live"); fs.mkdirSync(live);
    fs.writeFileSync(path.join(auditPath, "1-u.jsonl"), "");
    fs.writeFileSync(path.join(auditPath, "2-u.jsonl"), JSON.stringify({ type: "x", caller: { project_path: path.join(home, "gone") } }) + "\n");
    fs.writeFileSync(path.join(auditPath, "3-u.jsonl"), JSON.stringify({ type: "x", caller: { project_path: live } }) + "\n");
    expect(pruneAudit(auditPath, true)).toEqual({ empty: ["1-u.jsonl"], dead: ["2-u.jsonl"], kept: 1 });
    expect(fs.readdirSync(auditPath).length).toBe(3);
    pruneAudit(auditPath);
    expect(fs.readdirSync(auditPath)).toEqual(["3-u.jsonl"]);
  });
});

describe("compaction hook", () => {
  test("records what Pi is about to summarise away as a `compaction` audit entry", async () => {
    clearSessionEvents();
    const handlers: Record<string, any> = {};
    const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
    const logged: any[] = [];
    const audit: any = { log: (e: any) => { logged.push(e); recordSessionEvent({ timestamp: "2026-08-30T10:00:00.000Z", ...e }); } };
    setupCompaction(pi, audit);
    const notes: string[] = [];
    const ctx: any = { hasUI: true, ui: { notify: (m: string) => notes.push(m) } };
    expect(await handlers.session_before_compact({ reason: "threshold", preparation: { tokensBefore: 90000, fileOps: { read: new Set(["a.ts", "b.ts"]), edited: new Set(["b.ts"]), written: new Set(["c.ts"]) } } }, ctx)).toBeUndefined();
    await handlers.session_compact({ reason: "threshold", compactionEntry: { fromHook: false } }, ctx);
    expect(logged).toEqual([{ type: "compaction", reason: "threshold", tokens_before: 90000, read_files: ["a.ts"], modified_files: ["b.ts", "c.ts"], from_extension: false }]);
    expect(notes[0]).toBe("Context compacted (threshold) — 1 files read, 2 modified recorded in the audit trail");
    expect(sessionEvents("compaction")[0].detail).toBe("1 read, 2 modified summarised");
    await handlers.session_compact_failed({ reason: "overflow", error: "boom" }, ctx);
    expect(logged[1]).toMatchObject({ type: "compaction_failed", reason: "overflow", error: "boom" });
    // a compaction with no preceding before_compact still logs (never throws)
    await handlers.session_compact({ reason: "manual" }, { hasUI: false });
    expect(logged[2]).toMatchObject({ type: "compaction", reason: "manual", read_files: [], modified_files: [] });
  });
});
