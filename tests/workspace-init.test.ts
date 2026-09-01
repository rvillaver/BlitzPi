/**
 * Thinking blocks render unfolded by default and can dominate a long transcript; Pi already supports
 * collapsed-by-default thinking (`hideThinkingBlock`) with a live ctrl+t toggle — BlitzPi seeds it once,
 * on every session start (not just first-run setup), so an already-adopted project picks it up too.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { seedThinkingDisplay, setupWorkspaceInit } from "../src/workspace-init";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-wsinit-"));

describe("seedThinkingDisplay", () => {
  test("no settings.json yet -> creates one with hideThinkingBlock: true", () => {
    const cwd = tmp();
    expect(seedThinkingDisplay(cwd)).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(written.hideThinkingBlock).toBe(true);
  });

  test("existing settings.json without the key -> adds it, preserves the rest", () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ npmCommand: ["/x/bun"] }));
    expect(seedThinkingDisplay(cwd)).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf-8"));
    expect(written).toEqual({ npmCommand: ["/x/bun"], hideThinkingBlock: true });
  });

  test("key already present (true or false) -> never overwritten, a deliberate choice sticks", () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ hideThinkingBlock: false }));
    expect(seedThinkingDisplay(cwd)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf-8")).hideThinkingBlock).toBe(false);

    const cwd2 = tmp();
    fs.mkdirSync(path.join(cwd2, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(cwd2, ".pi", "settings.json"), JSON.stringify({ hideThinkingBlock: true }));
    expect(seedThinkingDisplay(cwd2)).toBe(false); // already true — no-op, not a fresh write
  });
});

describe("setupWorkspaceInit: an already-adopted project seeds the default on every session start", () => {
  test("hideThinkingBlock gets seeded and the user is told once, with the keystroke", async () => {
    const cwd = tmp();
    fs.mkdirSync(path.join(cwd, ".blitz"), { recursive: true }); // already a BlitzPi project
    const origCwd = process.cwd();
    process.chdir(cwd);
    try {
      const handlers: Record<string, any> = {};
      const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
      const notes: string[] = [];
      const ctx: any = { mode: "tui", hasUI: true, ui: { notify: (m: string) => notes.push(m), select: async () => "Yes — trust & set up here" } };
      setupWorkspaceInit(pi);
      await handlers.session_start({}, ctx);
      const written = JSON.parse(fs.readFileSync(path.join(cwd, ".pi", "settings.json"), "utf-8"));
      expect(written.hideThinkingBlock).toBe(true);
      expect(notes.some((n) => n.includes("ctrl+t"))).toBe(true);
      notes.length = 0;
      await handlers.session_start({}, ctx); // second session: already seeded, no repeat notice
      expect(notes.some((n) => n.includes("ctrl+t"))).toBe(false);
    } finally {
      process.chdir(origCwd);
    }
  });
});
