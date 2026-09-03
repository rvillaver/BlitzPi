/**
 * The shipped `development.md` profile is generic, not written for the adopting project. This nudges the agent
 * (auto-invocable, per the correction earlier this session) to draft a project-specific one right after adopting
 * — self-terminating: once `goodbehavior.profile` points somewhere else, the nudge stops on its own.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { GB_SKILLS, adoptGoodBehavior, syncSkills } from "../src/adopt-goodbehavior";
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

  test("adopting into a fresh project installs only the profile — skills sync separately, automatically", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-draftprofile-"));
    const r = adoptGoodBehavior(cwd);
    expect(r.installed.some((f) => f.endsWith("SKILL.md"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".pi", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".blitz", "goodbehavior", "profiles", "development.md"))).toBe(true);
  });
});

describe("syncSkills installs all 7 skills into THIS project, no adoption command needed", () => {
  test("installs all 7, including draft-profile", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-syncskills-"));
    const r = syncSkills(cwd);
    expect(r.installed.filter((f) => f.endsWith("SKILL.md"))).toHaveLength(7);
    expect(fs.existsSync(path.join(cwd, ".pi", "skills", "draft-profile-goodbehavior", "SKILL.md"))).toBe(true);
  });

  test("re-running when untouched reports no changes; an edited copy is kept, not overwritten", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-syncskills-"));
    syncSkills(cwd);
    const again = syncSkills(cwd);
    expect(again.installed).toHaveLength(0);
    expect(again.updated).toHaveLength(0);

    const editedFile = path.join(cwd, ".pi", "skills", "audit-goodbehavior", "SKILL.md");
    fs.writeFileSync(editedFile, "hand-edited content");
    const afterEdit = syncSkills(cwd);
    expect(afterEdit.kept).toContain(path.join(".pi", "skills", "audit-goodbehavior", "SKILL.md"));
    expect(fs.readFileSync(editedFile, "utf-8")).toBe("hand-edited content");
  });

  test("no-op against BlitzPi's own source checkout — never deletes/overwrites the shipped templates", () => {
    const repoRoot = path.join(__dirname, "..");
    const before = fs.readdirSync(path.join(repoRoot, ".pi", "skills")).sort();
    const r = syncSkills(repoRoot);
    expect(r).toEqual({ installed: [], updated: [], kept: [], removed: [] });
    expect(fs.readdirSync(path.join(repoRoot, ".pi", "skills")).sort()).toEqual(before);
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
