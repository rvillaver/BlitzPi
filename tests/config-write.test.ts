/**
 * Regression tests for writing BlitzPi's own config (audit 14, G14-7).
 *
 * The previous writers patched raw text with a regex. An ordinary user edit — commenting out an old choice in a
 * file BlitzPi ships full of commented examples — made them emit a duplicate mapping key, which `loadConfig()`
 * then threw on, which discarded every governance hook for the next session.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { setConfigValue } from "../src/config-write";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cfg-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const file = () => path.join(dir, "blitz.config.yaml");
const write = (s: string) => fs.writeFileSync(file(), s);
const read = () => fs.readFileSync(file(), "utf-8");

describe("setConfigValue", () => {
  it("does not produce a duplicate key when the user commented out the old value (G14-7)", () => {
    write("# BlitzPi project\ngoodbehavior:\n  # profile: development\n  profile: analysis\n");
    const r = setConfigValue(file(), ["goodbehavior", "profile"], "research");
    expect(r.ok).toBe(true);
    expect(() => parseYaml(read())).not.toThrow();
    expect(parseYaml(read()).goodbehavior.profile).toBe("research");
  });

  it("keeps the commented examples the file ships with", () => {
    write("# BlitzPi project — security config for THIS project.\nsandbox:\n  enabled: true\n  # cache: shared   # package-manager caches\n");
    expect(setConfigValue(file(), ["goodbehavior", "profile"], "creative").ok).toBe(true);
    expect(read()).toContain("# cache: shared");
    expect(read()).toContain("# BlitzPi project");
  });

  it("creates the file when absent", () => {
    const r = setConfigValue(file(), ["security_level"], "strict");
    expect(r).toEqual({ ok: true, created: true });
    expect(parseYaml(read()).security_level).toBe("strict");
  });

  it("leaves an already-invalid config untouched rather than silently rewriting it", () => {
    const broken = "sandbox:\n\tenabled: true\n";   // tab indentation
    write(broken);
    const r = setConfigValue(file(), ["security_level"], "guarded");
    expect(r.ok).toBe(false);
    expect(read()).toBe(broken);
  });

  it("round-trips every value it claims to have written", () => {
    write("security_level: guarded\n");
    for (const level of ["strict", "guarded", "monitored"]) {
      expect(setConfigValue(file(), ["security_level"], level).ok).toBe(true);
      expect(parseYaml(read()).security_level).toBe(level);
    }
  });
});
