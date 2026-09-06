/**
 * Which BlitzPi sessions are alive, and on what (CHAT-BRIDGE B17).
 *
 * The daemon has never had any way to know a user's terminal session exists: `BLITZ_BRIDGE_SOCKET` flows *outward*
 * into children it spawns itself, and nothing flows back. So a chat message and a terminal could both be driving
 * agents in one directory with neither aware of the other. This registry is the missing inbound half.
 *
 * Liveness is a **pid check, not a promise**. A session that exits cleanly deregisters; one that is killed, crashes,
 * or has its terminal closed does not — and a registry that believed its own entries would route chat messages to a
 * dead session. Every read prunes.
 */
import fs from "node:fs";
import path from "node:path";
import { bridgeDir } from "./bindings";

export interface LiveSession {
  /** Absolute, realpath-resolved: two spellings of one directory must not read as two projects. */
  project: string;
  /** Pi's session id, when the session has one (`--no-session` runs do not). */
  sessionId?: string;
  pid: number;
  startedAt: string;
  /** How the session was launched, for a human reading `blitzpi bridge sessions`. */
  mode?: string;
}

export const sessionsFile = (dir = bridgeDir()) => path.join(dir, "sessions.json");

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export class SessionRegistry {
  constructor(private file = sessionsFile()) {}

  private read(): LiveSession[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      return Array.isArray(parsed?.sessions) ? (parsed.sessions as LiveSession[]) : [];
    } catch { return []; }
  }

  private write(sessions: LiveSession[]): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, sessions }, null, 1));
    fs.renameSync(tmp, this.file);
  }

  /** Everything currently alive. Prunes dead pids as a side effect — a stale entry is worse than no entry. */
  list(): LiveSession[] {
    const all = this.read();
    const live = all.filter((s) => alive(s.pid));
    if (live.length !== all.length) this.write(live);
    return live;
  }

  /** Live sessions on one project, compared by realpath. */
  forProject(project: string): LiveSession[] {
    const want = real(project);
    return this.list().filter((s) => real(s.project) === want);
  }

  register(s: Omit<LiveSession, "startedAt"> & { startedAt?: string }): LiveSession {
    const entry: LiveSession = { ...s, project: real(s.project), startedAt: s.startedAt ?? new Date().toISOString() };
    // Replace any entry for this pid: a session that switches project (or re-registers) must not appear twice.
    this.write([...this.list().filter((e) => e.pid !== entry.pid), entry]);
    return entry;
  }

  deregister(pid: number): void {
    const before = this.list();
    const after = before.filter((e) => e.pid !== pid);
    if (after.length !== before.length) this.write(after);
  }
}

/**
 * Which session a conversation bound to `project` should be routed to.
 *
 * Deliberately returns a *reason* rather than a best guess. Two sessions on one project is genuine ambiguity about
 * which agent is allowed to touch the files, and picking one silently is how you get a surprise edit from the
 * terminal you were not looking at. The user chose refusal over any tie-break.
 */
export type Routing =
  | { kind: "one"; session: LiveSession }
  | { kind: "none" }
  | { kind: "ambiguous"; sessions: LiveSession[] };

export function routeFor(project: string, registry: SessionRegistry): Routing {
  const live = registry.forProject(project);
  if (live.length === 0) return { kind: "none" };
  if (live.length > 1) return { kind: "ambiguous", sessions: live };
  return { kind: "one", session: live[0] };
}

/** What the channel is told, in each case. Kept here so the wording is one thing, not scattered. */
export function routingMessage(project: string, r: Routing): string | undefined {
  if (r.kind === "one") return undefined;
  if (r.kind === "none") {
    return `No BlitzPi session is running in \`${project}\`. Chat drives a session you have open — start one there (\`blitzpi\`) and mention me again.`;
  }
  return `There are ${r.sessions.length} BlitzPi sessions running in \`${project}\` (pids ${r.sessions.map((s) => s.pid).join(", ")}). I will not guess which one should act on your files — leave one open and mention me again.`;
}
