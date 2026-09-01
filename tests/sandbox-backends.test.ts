/** A sandboxed command ends when its shell ends: background leftovers do not hold the tool open (the app-stack hang). */
import os from "node:os"; import fs from "node:fs"; import path from "node:path";
import { DEFAULT_COMMAND_TIMEOUT_MS, selectBackend, toolTimeoutMs, wrapForNamespace } from "../src/sandbox-backends";

test("wrapForNamespace returns the command's own exit code and kills the namespace leftovers", () => {
  const w = wrapForNamespace("server &\necho hi");
  expect(w).toBe("( server &\necho hi\n); __rc=$?; kill -9 -1 2>/dev/null; exit $__rc");
  expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(600_000);
});
test("pinned backend: `sleep 30 & echo hi` returns at once with exit 0 and no leftover", async () => {
  const b = selectBackend("pinned")!; const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-pin-"));
  let out = ""; const t0 = Date.now();
  const r = await b.exec("sleep 30 & echo hi; exit 0", dir, { onData: (d) => { out += d.toString(); } });
  expect(r.exitCode).toBe(0); expect(out).toContain("hi"); expect(Date.now() - t0).toBeLessThan(5000);
  const r2 = await b.exec("exit 3", dir, { onData: () => {} }); expect(r2.exitCode).toBe(3);
  const r3 = await b.exec("sleep 5; echo late", dir, { onData: () => {}, timeout: 500 }); expect(r3.exitCode).toBe(124);
});

test("toolTimeoutMs converts Pi's seconds to backend ms (the 'exceeded 0 s' regression)", () => {
  expect(toolTimeoutMs(120)).toBe(120_000);
  expect(toolTimeoutMs(undefined)).toBeUndefined();
  expect(toolTimeoutMs(0)).toBeUndefined();
});
test("every backend exports BLITZ_REAL_HOME alongside the pinned HOME (bridge/feeds/audit paths must survive confinement)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-realhome-"));
  const realHome = os.homedir();
  for (const pref of ["pinned", "bwrap", "sandbox-exec"] as const) {
    const b = selectBackend(pref);
    if (!b) continue; // not available on this host
    let out = "";
    const r = await b.exec("echo \"HOME=$HOME BLITZ_REAL_HOME=$BLITZ_REAL_HOME\"", dir, { onData: (d) => { out += d.toString(); } });
    expect(r.exitCode).toBe(0);
    expect(out).toContain(`HOME=${b.name === "sandbox-exec" ? fs.realpathSync(dir) : dir}`); // HOME stays pinned to the workspace
    expect(out).toContain(`BLITZ_REAL_HOME=${realHome}`); // the real home escapes the pin for BlitzPi's own global state
  }
});
test("bwrap: ssh parses its config inside the sandbox (no 'Bad owner' on /etc/ssh/ssh_config.d)", async () => {
  const b = selectBackend("bwrap");
  if (!b || !fs.existsSync("/etc/ssh/ssh_config.d") || !fs.existsSync("/usr/bin/ssh")) return; // nothing to check on this host
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-ssh-"));
  let out = "";
  const r = await b.exec("ssh -G git@github.com 2>&1 | head -3", dir, { onData: (d) => { out += d.toString(); }, timeout: 15_000 });
  expect(out).not.toContain("Bad owner or permissions");
  expect(r.exitCode).toBe(0);
});
