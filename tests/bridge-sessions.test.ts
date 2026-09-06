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

describe("routing decision", () => {
  test("no live session -> tells the channel to start one, and names the project", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    const route = routeFor(p, r);
    expect(route.kind).toBe("none");
    expect(routingMessage(p, route)).toContain(p);
    expect(routingMessage(p, route)).toMatch(/start one/i);
  });

  test("exactly one -> route to it, and say nothing", () => {
    const r = new SessionRegistry(tmpFile());
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    const route = routeFor(p, r);
    expect(route.kind).toBe("one");
    expect(routingMessage(p, route)).toBeUndefined();
  });

  test("two live sessions -> refuse and say so, rather than guess which agent edits the files", () => {
    const f = tmpFile();
    const r = new SessionRegistry(f);
    const p = proj();
    r.register({ project: p, pid: process.pid, mode: "tui" });
    // second live pid: this process's parent is alive by definition
    r.register({ project: p, pid: process.ppid, mode: "tui" });
    const route = routeFor(p, r);
    expect(route.kind).toBe("ambiguous");
    const msg = routingMessage(p, route)!;
    expect(msg).toMatch(/will not guess/i);
    expect(msg).toContain(String(process.pid));
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
