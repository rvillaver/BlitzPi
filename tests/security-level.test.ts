/**
 * SP-2/SP-5: the security tier changes the permission ladder (never for a non-interactive run, which always
 * gets the shipped `guarded` ladder — see permission-gate.ts), and `blitzpi level` / `/blitz-level` read and
 * write `security_level` in project/global config without disturbing the rest of a hand-authored YAML file.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PermissionGate } from "../src/permission-gate";
import { PermissionMemory } from "../src/permissions";

function harness(level: "strict" | "guarded" | "monitored", hasUI: boolean) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-level-gate-"));
  const project = path.join(tmp, "proj");
  fs.mkdirSync(path.join(project, ".blitz"), { recursive: true });
  const audit: any = { log: () => {} };
  const asked: string[] = [];
  const ctx: any = { hasUI, ui: { notify: () => {}, select: async (q: string, opts: string[]) => { asked.push(q); return "Yes"; } } };
  const gate = new PermissionGate({ project, install: path.join(tmp, "inst"), home: path.join(tmp, "home"), scratch: [] }, new PermissionMemory(path.join(project, ".blitz", "permissions.json")), audit, level);
  return { gate, ctx, asked, project };
}

describe("PermissionGate tier plumbing", () => {
  test("monitored + interactive: project write goes silent, no prompt", async () => {
    const { gate, ctx, asked, project } = harness("monitored", true);
    const r = await gate.resolvePath("write", path.join(project, "x.ts"), "write", ctx);
    expect(r).toMatchObject({ allow: true, reason: "in-scope", level: "silent" });
    expect(asked).toHaveLength(0);
  });

  test("guarded + interactive: project write still asks (unchanged from today)", async () => {
    const { gate, ctx, asked, project } = harness("guarded", true);
    const r = await gate.resolvePath("write", path.join(project, "x.ts"), "write", ctx);
    expect(r.allow).toBe(true);
    expect(r.level).toBe("ask");
    expect(asked).toHaveLength(1);
  });

  test("monitored + NON-interactive: forced to 'guarded' — no silent loosening reaches an unattended run", async () => {
    const { gate, ctx, project } = harness("monitored", false);
    const r = await gate.resolvePath("write", path.join(project, "x.ts"), "write", ctx);
    // guarded ladder: write/project = "ask"; non-interactive auto-approves anything short of "dangerous"
    expect(r).toMatchObject({ allow: true, level: "ask", reason: "auto-approved (non-interactive)" });
  });

  test("strict + interactive: unchanged from guarded on the zone ladder itself", async () => {
    const strict = harness("strict", true);
    const guarded = harness("guarded", true);
    const rs = await strict.gate.resolvePath("write", path.join(strict.project, "x.ts"), "write", strict.ctx);
    const rg = await guarded.gate.resolvePath("write", path.join(guarded.project, "x.ts"), "write", guarded.ctx);
    expect(rs.level).toBe(rg.level);
  });

  test("dangerous stays dangerous in every tier, interactive or not", async () => {
    for (const level of ["strict", "guarded", "monitored"] as const) {
      for (const hasUI of [true, false]) {
        const { gate, ctx } = harness(level, hasUI);
        const r = await gate.resolveDangerousCommand("sudo rm -rf /", "sudo", ctx);
        expect(r.level).toBe("dangerous");
        if (!hasUI) expect(r.allow).toBe(false); // refused, no human to warn
      }
    }
  });
});

describe("security-level module (SP-5)", () => {
  function tmpProject() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-level-cfg-"));
    fs.mkdirSync(path.join(tmp, ".blitz"), { recursive: true });
    return tmp;
  }

  test("no config anywhere -> default, source 'default'", () => {
    jest.resetModules();
    const { describeSecurityLevel } = require("../src/security-level");
    const project = tmpProject();
    expect(describeSecurityLevel(project)).toEqual({ level: "guarded", source: "default" });
  });

  test("setSecurityLevel inserts the line without disturbing existing comments/content", () => {
    jest.resetModules();
    const { setSecurityLevel, describeSecurityLevel } = require("../src/security-level");
    const project = tmpProject();
    const file = path.join(project, ".blitz", "blitz.config.yaml");
    fs.writeFileSync(file, "# a hand-written comment\nthreat_detection:\n  tier: 3\n");
    const { from } = setSecurityLevel("strict", { cwd: project });
    expect(from).toBe("guarded"); // was the default before this call
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("# a hand-written comment");
    expect(content).toContain("tier: 3");
    expect(content).toMatch(/^security_level: strict$/m);
    expect(describeSecurityLevel(project)).toEqual({ level: "strict", source: "project" });
  });

  test("setSecurityLevel again REPLACES the line, never duplicates it", () => {
    jest.resetModules();
    const { setSecurityLevel } = require("../src/security-level");
    const project = tmpProject();
    setSecurityLevel("strict", { cwd: project });
    const { from } = setSecurityLevel("monitored", { cwd: project });
    expect(from).toBe("strict");
    const content = fs.readFileSync(path.join(project, ".blitz", "blitz.config.yaml"), "utf-8");
    expect(content.match(/^security_level:/gm)).toHaveLength(1);
    expect(content).toMatch(/^security_level: monitored$/m);
  });

  test("--global writes to the global file, project file untouched", () => {
    jest.resetModules();
    const origHome = process.env.HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-level-home-"));
    process.env.HOME = home;
    try {
      const { setSecurityLevel, describeSecurityLevel } = require("../src/security-level");
      const project = tmpProject();
      setSecurityLevel("monitored", { global: true, cwd: project });
      expect(fs.existsSync(path.join(project, ".blitz", "blitz.config.yaml"))).toBe(false);
      expect(fs.readFileSync(path.join(home, ".blitz", "blitz.config.yaml"), "utf-8")).toMatch(/^security_level: monitored$/m);
      expect(describeSecurityLevel(project)).toEqual({ level: "monitored", source: "global" });
    } finally {
      process.env.HOME = origHome;
    }
  });
});
