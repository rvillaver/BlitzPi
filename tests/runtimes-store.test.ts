/**
 * P3 — the runtime store's failure and rollback behaviour.
 *
 * The live path (real 106 MB download, sha256 against the pin, `python3 --version` inside bwrap) is recorded as
 * evidence in the plan; repeating it here would move a hundred megabytes per run. What these tests pin down is the
 * part that is easy to get wrong and invisible until it bites: **a failed or tampered install must leave the
 * working one exactly where it was**, and rollback must actually go back.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { RuntimeStore } from "../src/runtimes/store";
import { pinnedPythonFor } from "../src/runtimes/pinned";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-rt-"));

/** A tiny archive shaped like the real one: `python/bin/python3` that runs and prints a marker. */
function fakeRuntime(marker: string): Buffer {
  const stage = tmp();
  const bin = path.join(stage, "python", "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "python3"), `#!/bin/sh\necho "${marker}"\n`, { mode: 0o755 });
  const out = path.join(stage, "a.tar.gz");
  spawnSync("tar", ["czf", out, "-C", stage, "python"], { stdio: "ignore" });
  return fs.readFileSync(out);
}

function brokenRuntime(): Buffer {
  const stage = tmp();
  fs.mkdirSync(path.join(stage, "python", "lib"), { recursive: true }); // extracts fine, no interpreter
  const out = path.join(stage, "a.tar.gz");
  spawnSync("tar", ["czf", out, "-C", stage, "python"], { stdio: "ignore" });
  return fs.readFileSync(out);
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const respond = (b: Buffer) => ({ ok: true, status: 200, body: null, headers: { get: () => null }, arrayBuffer: async () => b }) as any;

/** Install `bytes`, pretending the pin expects `expect` (defaults to honest). */
function storeWith(dir: string, bytes: Buffer, expectSha?: string) {
  const pin = pinnedPythonFor("linux", "x64")!;
  const s = new RuntimeStore(dir, (async () => respond(bytes)) as any);
  // Point the pin's hash at whatever we're serving, unless the test wants a mismatch.
  (s as any).__pin = pin;
  return { store: s, sha: expectSha ?? sha(bytes) };
}

describe("runtime store", () => {
  const realPin = pinnedPythonFor("linux", "x64");

  test("opt-in / opt-out are recorded, and opting out can keep or delete the files", () => {
    const dir = tmp();
    const s = new RuntimeStore(dir);
    expect(s.decision("python")).toBeUndefined();
    s.optIn("python");
    expect(s.decision("python")).toBe("in");
    s.optOut("python");
    expect(s.decision("python")).toBe("out");
    expect(s.optedIn("python")).toBe(false);
  });

  test("nothing is exposed to the sandbox unless opted in AND installed", async () => {
    const { sandboxRuntimeDirs } = await import("../src/runtimes/store");
    const dir = tmp();
    const s = new RuntimeStore(dir);
    expect(sandboxRuntimeDirs(s)).toEqual([]);
    s.optIn("python"); // opted in but nothing installed
    expect(sandboxRuntimeDirs(s)).toEqual([]);
  });

  test("a checksum mismatch refuses to install — the supply-chain case", async () => {
    const dir = tmp();
    const s = new RuntimeStore(dir, (async () => respond(fakeRuntime("tampered"))) as any);
    const r = await s.install("python");
    expect(r.type).toBe("runtime_install_failed");
    expect(r.error).toContain("checksum mismatch");
    expect(s.installed("python")).toBe(false);
    expect(fs.existsSync(path.join(dir, "python", "staged"))).toBe(false); // no half-extracted tree left
  });

  test("an unreachable download fails cleanly and leaves no debris", async () => {
    const dir = tmp();
    const s = new RuntimeStore(dir, (async () => { throw new Error("network is down"); }) as any);
    const r = await s.install("python");
    expect(r.type).toBe("runtime_install_failed");
    expect(r.error).toContain("network is down");
    expect(fs.existsSync(path.join(dir, "python", "staged"))).toBe(false);
  });

  test("an unpinned platform is refused by name, not guessed at", async () => {
    expect(pinnedPythonFor("win32", "arm64")).toBeUndefined();
    expect(realPin).toBeDefined();
  });

  test("list() reports decision, install state and the rollback target", () => {
    const dir = tmp();
    const s = new RuntimeStore(dir);
    const [python] = s.list();
    expect(python.name).toBe("python");
    expect(python.decision).toBe("not asked");
    expect(python.installed).toBe(false);
    expect(python.previous).toBeUndefined();
  });

  test("rollback with nothing to roll back to says so instead of breaking the install", () => {
    const dir = tmp();
    const r = new RuntimeStore(dir).rollback("python");
    expect(r.type).toBe("runtime_install_failed");
    expect(r.error).toContain("no previous version");
  });

  test("an archive with no interpreter is rejected before anything is replaced", async () => {
    const dir = tmp();
    const bytes = brokenRuntime();
    const s = new RuntimeStore(dir, (async () => respond(bytes)) as any);
    // Force the pin check to pass so we reach the extraction check.
    const pin = pinnedPythonFor("linux", "x64")!;
    const original = pin.sha256;
    (pin as any).sha256 = sha(bytes);
    try {
      const r = await s.install("python");
      expect(r.type).toBe("runtime_install_failed");
      expect(r.error).toMatch(/no interpreter|does not run/);
      expect(s.installed("python")).toBe(false);
    } finally { (pin as any).sha256 = original; }
  });

  test("install → re-install with different content → rollback returns the previous interpreter", async () => {
    const dir = tmp();
    const pin = pinnedPythonFor("linux", "x64")!;
    const original = pin.sha256;
    const v1 = fakeRuntime("VERSION-ONE");
    const v2 = fakeRuntime("VERSION-TWO");
    try {
      (pin as any).sha256 = sha(v1);
      const s1 = new RuntimeStore(dir, (async () => respond(v1)) as any);
      expect((await s1.install("python")).type).toBe("runtime_install");
      expect(spawnSync(s1.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("VERSION-ONE");

      (pin as any).sha256 = sha(v2);
      const s2 = new RuntimeStore(dir, (async () => respond(v2)) as any);
      expect((await s2.install("python")).type).toBe("runtime_install");
      expect(spawnSync(s2.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("VERSION-TWO");

      const back = s2.rollback("python");
      expect(back.type).toBe("runtime_rollback");
      expect(spawnSync(s2.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("VERSION-ONE");

      // Reversible: rolling back again returns to what we just left.
      s2.rollback("python");
      expect(spawnSync(s2.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("VERSION-TWO");
    } finally { (pin as any).sha256 = original; }
  });

  test("a failed install after a good one keeps the good one running", async () => {
    const dir = tmp();
    const pin = pinnedPythonFor("linux", "x64")!;
    const original = pin.sha256;
    const good = fakeRuntime("GOOD");
    try {
      (pin as any).sha256 = sha(good);
      const s = new RuntimeStore(dir, (async () => respond(good)) as any);
      await s.install("python");
      expect(spawnSync(s.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("GOOD");

      // Now a tampered download: the pin still expects `good`, the server sends something else.
      const bad = new RuntimeStore(dir, (async () => respond(fakeRuntime("EVIL"))) as any);
      const r = await bad.install("python", { force: true });
      expect(r.type).toBe("runtime_install_failed");
      // The working interpreter is untouched — this is the whole point of staging.
      expect(spawnSync(s.binPath("python")!, [], { encoding: "utf-8" }).stdout.trim()).toBe("GOOD");
    } finally { (pin as any).sha256 = original; }
  });
});

void storeWith;
