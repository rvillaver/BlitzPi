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
  /** Conversation key this session holds, if it claimed one (`platform:id`). */
  claimed?: string;
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

  /** Exposed for claim updates, which rewrite the whole list. */
  writeAll(sessions: LiveSession[]): void { this.write(sessions); }

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

  /**
   * The live session holding `convKey`, if any.
   *
   * Reading through `list()` is the point: a claim is only as alive as the process that made it, so a holder that
   * was killed disappears here rather than blocking the channel until someone notices.
   */
  holderOf(convKey: string): LiveSession | undefined {
    return this.list().find((s) => s.claimed === convKey);
  }

  /**
   * Take the claim if it is free. Returns the holder either way, so a caller can say who has it rather than only
   * that it failed. Winning requires being the only live claimant — the user's rule: *"win if its the only active
   * one"* — and re-claiming what you already hold is a no-op success, not a conflict with yourself.
   */
  tryClaim(convKey: string, pid = process.pid): { ok: boolean; holder: LiveSession | undefined } {
    const held = this.holderOf(convKey);
    if (held && held.pid !== pid) return { ok: false, holder: held };
    const sessions = this.list();
    const mine = sessions.find((s) => s.pid === pid);
    if (!mine) return { ok: false, holder: held }; // not registered: nothing to attach the claim to
    this.writeAll(sessions.map((s) => (s.pid === pid ? { ...s, claimed: convKey } : s)));
    return { ok: true, holder: { ...mine, claimed: convKey } };
  }

  /** Give up a claim without ending the session. */
  release(convKey: string, pid = process.pid): void {
    const sessions = this.list();
    if (!sessions.some((s) => s.pid === pid && s.claimed === convKey)) return;
    this.writeAll(sessions.map((s) => (s.pid === pid ? { ...s, claimed: undefined } : s)));
  }

  deregister(pid: number): void {
    const before = this.list();
    const after = before.filter((e) => e.pid !== pid);
    if (after.length !== before.length) this.write(after);
  }
}

/**
 * Which session a conversation is routed to — the one holding its **claim**, or none.
 *
 * This used to count live sessions on the project and refuse when there were two. The claim model makes that
 * impossible instead of detectable: exactly one session can hold a conversation, so there is never a tie to break.
 * A second terminal on the same project is a perfectly normal thing to have; it simply is not the one chat drives.
 */
export type Routing =
  | { kind: "held"; session: LiveSession }
  | { kind: "unheld"; onProject: LiveSession[] };

export function routeFor(convKey: string, project: string, registry: SessionRegistry): Routing {
  const holder = registry.holderOf(convKey);
  if (holder) return { kind: "held", session: holder };
  return { kind: "unheld", onProject: registry.forProject(project) };
}

/**
 * What the channel is told when nothing holds it. Distinguishes "nobody is here" from "someone is here but has
 * not attached" — the second is one command away from working, and saying so is the difference between a dead end
 * and an instruction.
 */
export function routingMessage(project: string, r: Routing): string | undefined {
  if (r.kind === "held") return undefined;
  if (r.onProject.length === 0) {
    return `No BlitzPi session is attached to \`${project}\`. Chat drives a session you have open — start one there (\`blitzpi\`) and I will pick it up.`;
  }
  return `A BlitzPi session is running in \`${project}\` (pid ${r.onProject.map((s) => s.pid).join(", ")}) but has not attached to this channel. Run \`/blitz-bridge attach\` in it.`;
}
