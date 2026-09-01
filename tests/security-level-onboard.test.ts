import fs from "fs"; import os from "os"; import path from "path";
import { setupSecurityLevelOnboarding, LEVEL_QUESTION, CHOICES, NOT_NOW } from "../src/security-level-onboard";
import { describeSecurityLevel } from "../src/security-level";

const tmpProject = () => { const p = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-lvl-onb-")); fs.mkdirSync(path.join(p, ".blitz"), { recursive: true }); return p; };

function harness(cwd: string, answer: string | undefined, version = "1.2.102") {
  const handlers: Record<string, any> = {}; const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
  const logged: any[] = []; let asked = 0; const notes: string[] = [];
  setupSecurityLevelOnboarding(pi, { log: (e: any) => logged.push(e) } as any, version);
  const ctx: any = { mode: "tui", hasUI: true, ui: { select: async (q: string) => { asked++; expect(q).toBe(LEVEL_QUESTION); return answer; }, notify: (m: string) => notes.push(m) } };
  const origCwd = process.cwd();
  return {
    start: async () => { process.chdir(cwd); try { await handlers.session_start({}, ctx); } finally { process.chdir(origCwd); } },
    startPrint: async () => { process.chdir(cwd); try { await handlers.session_start({}, { ...ctx, mode: "print", hasUI: false }); } finally { process.chdir(origCwd); } },
    logged, notes, asked: () => asked,
  };
}

describe("in-app security-level onboarding (SP-4, asks once per project+version while undecided)", () => {
  test("choosing a tier sets it (project scope) and logs via 'onboarding'", async () => {
    const project = tmpProject();
    const h = harness(project, CHOICES[0]); // "strict — ..."
    await h.start();
    expect(describeSecurityLevel(project)).toEqual({ level: "strict", source: "project" });
    expect(h.logged[0]).toMatchObject({ type: "security_level", from: "guarded", to: "strict", scope: "project", via: "onboarding" });
    expect(h.notes[0]).toContain("security level: strict");
    // decided → never asked again, even on a later version
    const again = harness(project, CHOICES[0], "1.2.103");
    await again.start();
    expect(again.asked()).toBe(0);
  });

  test("Not now: asks again only on a new version; print mode never asks", async () => {
    const project = tmpProject();
    const later = harness(project, NOT_NOW);
    await later.start(); await later.start();
    expect(later.asked()).toBe(1);
    expect(later.logged[0]).toMatchObject({ type: "security_level_onboarding", decision: "later" });
    expect(describeSecurityLevel(project).source).toBe("default"); // still undecided
    const next = harness(project, NOT_NOW, "1.2.103");
    await next.start();
    expect(next.asked()).toBe(1); // new version -> asked again

    const p = harness(tmpProject(), CHOICES[0]);
    await p.startPrint();
    expect(p.asked()).toBe(0);
  });

  test("a global default already set -> never asked in this project", async () => {
    const origHome = process.env.HOME;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-lvl-home-"));
    fs.mkdirSync(path.join(home, ".blitz"), { recursive: true });
    fs.writeFileSync(path.join(home, ".blitz", "blitz.config.yaml"), "security_level: monitored\n");
    process.env.HOME = home;
    try {
      const project = tmpProject();
      const h = harness(project, CHOICES[0]);
      await h.start();
      expect(h.asked()).toBe(0);
      expect(h.logged).toHaveLength(0);
    } finally {
      process.env.HOME = origHome;
    }
  });
});
