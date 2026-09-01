/**
 * The shipped `development.md` profile is generic, not written for the adopting project. This nudges the agent
 * (auto-invocable, per the correction earlier this session) to draft a project-specific one right after adopting
 * — self-terminating: once `goodbehavior.profile` points somewhere else, the nudge stops on its own.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { GB_SKILLS, adoptGoodBehavior } from "../src/adopt-goodbehavior";
import { setupGoodBehavior } from "../src/goodbehavior";

function harness(cwd: string, profileName: string) {
  const handlers: Record<string, any> = {};
  const commands: Record<string, any> = {};
  const pi: any = {
    on: (n: string, h: any) => { handlers[n] = h; },
    registerCommand: (n: string, opts: any) => { commands[n] = opts.handler; },
    sendMessage: (msg: any) => { sent.push(msg); },
  };
  const sent: any[] = [];
  pi.sendMessage = (msg: any) => sent.push(msg);
  const config: any = { goodbehavior: { profile: profileName } };
  const origCwd = process.cwd();
  process.chdir(cwd);
  setupGoodBehavior(pi, config);
  process.chdir(origCwd);
  return { handlers, commands, sent };
}

describe("GB_SKILLS ships draft-profile-goodbehavior", () => {
  test("the new skill is in the list and its file exists", () => {
    expect(GB_SKILLS).toContain("draft-profile-goodbehavior");
    const shipped = path.join(__dirname, "..", ".pi", "skills", "draft-profile-goodbehavior", "SKILL.md");
    expect(fs.existsSync(shipped)).toBe(true);
  });

  test("adopting into a fresh project installs all 7 skills, including draft-profile", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    const r = adoptGoodBehavior(cwd);
    expect(r.installed.filter((f) => f.endsWith("SKILL.md"))).toHaveLength(7);
    expect(fs.existsSync(path.join(cwd, ".pi", "skills", "draft-profile-goodbehavior", "SKILL.md"))).toBe(true);
  });
});

describe("session_start nudge: draft a tailored profile while still on the generic default", () => {
  test("adopted + still 'development' -> nudges, and the text matches the skill's own trigger phrase", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    adoptGoodBehavior(cwd);
    const { handlers, sent } = harness(cwd, "development");
    await handlers.session_start({}, { mode: "tui", hasUI: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("draft a project-specific GoodBehavior profile");
  });

  test("adopted + a tailored profile already set -> no nudge (self-terminating)", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    adoptGoodBehavior(cwd);
    const { handlers, sent } = harness(cwd, "research");
    await handlers.session_start({}, { mode: "tui", hasUI: true });
    expect(sent).toHaveLength(0);
  });

  test("not adopted at all -> no nudge", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    const { handlers, sent } = harness(cwd, "development");
    await handlers.session_start({}, { mode: "tui", hasUI: true });
    expect(sent).toHaveLength(0);
  });

  test("non-interactive (print mode) -> no nudge, matches every other onboarding pattern in this codebase", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    adoptGoodBehavior(cwd);
    const { handlers, sent } = harness(cwd, "development");
    await handlers.session_start({}, { mode: "print", hasUI: false });
    expect(sent).toHaveLength(0);
  });
});

describe("/adopt-goodbehavior command message", () => {
  test("includes the nudge when the profile is still the generic default", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    const { commands, sent } = harness(cwd, "development");
    await commands["adopt-goodbehavior"]("", { hasUI: true });
    expect(sent[0].content).toContain("Draft a project-specific GoodBehavior profile for it");
  });

  test("does not include it once a tailored profile is configured", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    const { commands, sent } = harness(cwd, "research");
    await commands["adopt-goodbehavior"]("", { hasUI: true });
    expect(sent[0].content).not.toContain("Draft a project-specific");
  });
});
