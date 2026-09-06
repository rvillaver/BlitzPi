/**
 * CHAT-BRIDGE B17/B18 — the session registry, and the routing decision built on it.
 *
 * The registry's whole job is to be trustworthy about what is alive. A stale entry is worse than no entry: it sends
 * a chat message to a dead session, or reports a collision that ended an hour ago. So liveness is a pid check on
 * every read, not a promise made at registration.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { SessionRegistry, routeFor, routingMessage } from "../src/bridge/sessions";
import { announceSession } from "../src/bridge/announce";
import { BindingsStore } from "../src/bridge/bindings";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-sess-")), "sessions.json");
const proj = () => fs.mkdtempSync(path.join(os.tmpdir(), "proj-"));
/** A pid that is certainly not running: allocate one and let it exit. */
const deadPid = 999_999_999;

describe("registry", () => {
  test("registers and lists a live session", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    expect(r.list().map((s) => s.pid)).toEqual([process.pid]);
    expect(r.forProject(p)).toHaveLength(1);
  });

  test("prunes a dead pid on read — a killed terminal must not linger", () => {
    const f = tmpFile();
    const r = new SessionRegistry(f);
    const p = proj();
    r.register({ project: p, pid: deadPid, mode: "tui" });
    expect(r.list()).toHaveLength(0);
    // and the prune is persisted, not just filtered in memory
    expect(JSON.parse(fs.readFileSync(f, "utf-8")).sessions).toHaveLength(0);
  });

  test("re-registering the same pid replaces rather than duplicates", () => {
    const r = new SessionRegistry(tmpFile());
    const a = proj(), b = proj();
    r.register({ project: a, pid: process.pid, mode: "tui" });
    r.register({ project: b, pid: process.pid, mode: "tui" });
    expect(r.list()).toHaveLength(1);
    expect(r.forProject(b)).toHaveLength(1);
    expect(r.forProject(a)).toHaveLength(0);
  });

  test("projects are matched by realpath, so two spellings are one project", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    expect(r.forProject(path.join(p, "..", path.basename(p)))).toHaveLength(1);
  });

  test("deregister removes only that pid", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    r.deregister(process.pid);
    expect(r.list()).toHaveLength(0);
  });
});

describe("claim", () => {
  test("an unheld conversation is won by the only live session — the user's rule", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    const { ok } = r.tryClaim("discord:1", process.pid);
    expect(ok).toBe(true);
    expect(r.holderOf("discord:1")?.pid).toBe(process.pid);
  });

  test("a second session does not steal a held claim, and is told who has it", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    r.register({ project: p, pid: process.ppid, mode: "tui" });
    expect(r.tryClaim("discord:1", process.pid).ok).toBe(true);
    const second = r.tryClaim("discord:1", process.ppid);
    expect(second.ok).toBe(false);
    expect(second.holder?.pid).toBe(process.pid);
    expect(r.holderOf("discord:1")?.pid).toBe(process.pid); // unchanged
  });

  test("re-claiming what you already hold succeeds instead of conflicting with yourself", () => {
    const r = new SessionRegistry(tmpFile());
    r.register({ project: proj(), pid: process.pid, mode: "tui" });
    expect(r.tryClaim("discord:1", process.pid).ok).toBe(true);
    expect(r.tryClaim("discord:1", process.pid).ok).toBe(true);
  });

  test("a dead holder does not hold the channel hostage", () => {
    const f = tmpFile();
    const r = new SessionRegistry(f);
    const p = proj();
    // a claim written by a process that is gone
    r.writeAll([{ project: p, pid: deadPid, startedAt: new Date().toISOString(), claimed: "discord:1" }]);
    expect(r.holderOf("discord:1")).toBeUndefined();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    expect(r.tryClaim("discord:1", process.pid).ok).toBe(true);
  });

  test("release gives it up without ending the session", () => {
    const r = new SessionRegistry(tmpFile());
    r.register({ project: proj(), pid: process.pid, mode: "tui" });
    r.tryClaim("discord:1", process.pid);
    r.release("discord:1", process.pid);
    expect(r.holderOf("discord:1")).toBeUndefined();
    expect(r.list()).toHaveLength(1); // still a live session, just not attached
  });

  test("an unregistered process cannot claim — there is nothing to attach it to", () => {
    const r = new SessionRegistry(tmpFile());
    expect(r.tryClaim("discord:1", process.pid).ok).toBe(false);
  });
});

describe("routing follows the claim", () => {
  test("held -> route there, say nothing", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    r.tryClaim("discord:1", process.pid);
    const route = routeFor("discord:1", p, r);
    expect(route.kind).toBe("held");
    expect(routingMessage(p, route)).toBeUndefined();
  });

  test("nobody there -> tell them to start a session", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    const msg = routingMessage(p, routeFor("discord:1", p, r))!;
    expect(msg).toMatch(/no blitzpi session is attached/i);
    expect(msg).toContain(p);
  });

  test("session open but unattached -> name the fix, not just the problem", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    const msg = routingMessage(p, routeFor("discord:1", p, r))!;
    expect(msg).toContain("has not attached");
    expect(msg).toContain("/blitz-bridge attach");
  });
});

describe("announceSession", () => {
  const ctx = (mode: string, hasUI = true) => ({ mode, hasUI, ui: { notify: () => {} } }) as any;

  test("a bridge-spawned child never registers — it would look like a collision with itself", () => {
    const r = new SessionRegistry(tmpFile());
    process.env.BLITZ_BRIDGE_CONV = "discord:1";
    try {
      expect(announceSession(ctx("tui"), proj(), r)).toBeUndefined();
      expect(r.list()).toHaveLength(0);
    } finally { delete process.env.BLITZ_BRIDGE_CONV; }
  });

  test("print/rpc runs are nobody's open session", () => {
    const r = new SessionRegistry(tmpFile());
    announceSession(ctx("print"), proj(), r);
    expect(r.list()).toHaveLength(0);
  });

  test("an unbound project registers silently — nothing to warn about", () => {
    const r = new SessionRegistry(tmpFile());
    const b = new BindingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "b-")), "bindings.json"));
    const p = proj();
    expect(announceSession(ctx("tui"), p, r, b)).toBeUndefined();
    expect(r.forProject(p)).toHaveLength(1);
  });

  test("a project marked attached reclaims its conversation on launch — and wins when unheld", () => {
    const r = new SessionRegistry(tmpFile());
    const b = new BindingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "b-")), "bindings.json"));
    const p = proj();
    b.bind({ platform: "discord", id: "42" }, p, { operators: ["op1"] });
    b.update({ platform: "discord", id: "42" }, { attached: true });
    const msg = announceSession(ctx("tui"), p, r, b)!;
    expect(msg).toMatch(/^Attached to discord:42/);
    expect(r.holderOf("discord:42")?.pid).toBe(process.pid);
  });

  test("a project marked attached does NOT steal a claim another session holds", () => {
    const r = new SessionRegistry(tmpFile());
    const b = new BindingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "b-")), "bindings.json"));
    const p = proj();
    b.bind({ platform: "discord", id: "42" }, p, { operators: ["op1"] });
    b.update({ platform: "discord", id: "42" }, { attached: true });
    // someone else already holds it, and is alive
    r.register({ project: p, pid: process.ppid, mode: "tui" });
    r.tryClaim("discord:42", process.ppid);
    const msg = announceSession(ctx("tui"), p, r, b)!;
    expect(msg).toMatch(/held by another BlitzPi session/);
    expect(r.holderOf("discord:42")?.pid).toBe(process.ppid); // unchanged
  });

  test("a bound project warns that chat runs its own agent in the same directory", () => {
    const r = new SessionRegistry(tmpFile());
    const b = new BindingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "b-")), "bindings.json"));
    const p = proj();
    b.bind({ platform: "discord", id: "42" }, p, { operators: ["op1"] });
    const msg = announceSession(ctx("tui"), p, r, b)!;
    expect(msg).toContain("discord:42");
    expect(msg).toMatch(/own agent in this same directory/);
  });
});
