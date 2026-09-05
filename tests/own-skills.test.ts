/**
 * UX-2: BlitzPi's own header/banner states plainly which skills are its own (GoodBehavior + bridge) vs. the
 * third-party ones the stock [Skills] panel (rendered by pi-cc-extensions, not us) lists alongside them.
 *
 * The count is read from what the INSTALL declares (`package.json` → `pi.skills`), never hard-coded and never
 * from `<cwd>/.pi/skills`. Reading the project directory made this line lie: skills written during session_start
 * are on disk but Pi has already run its one skill scan, so a freshly set-up folder reported "7 GoodBehavior" in
 * a session where ctrl+o listed none of them (ONBOARDING-SETUP S4a). Package skills load in every session, so the
 * declaration is the truth — and it is deliberately independent of the current project.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { goodBehaviorSkillCount, ownSkillsLine } from "../src/ui/own-skills";

describe("goodBehaviorSkillCount / ownSkillsLine", () => {
  const origCwd = process.cwd();
  afterEach(() => process.chdir(origCwd));

  test("counts the -goodbehavior skills the install declares in package.json (bridge excluded)", () => {
    const declared = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).pi.skills as string[]);
    const expected = declared.filter((s) => s.endsWith("-goodbehavior")).length;
    expect(expected).toBeGreaterThan(0); // the whole point: they ship with BlitzPi
    expect(goodBehaviorSkillCount()).toBe(expected);
    expect(ownSkillsLine()).toBe(
      `BlitzPi's own skills: ${expected} GoodBehavior + bridge — the agent invokes these on its own when a request matches; anything else in [Skills] is a bundled extension, not ours`,
    );
  });

  test("independent of the project: an empty folder reports the same count, because skills come from the install", () => {
    const before = goodBehaviorSkillCount();
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-brand-")));
    expect(goodBehaviorSkillCount()).toBe(before);
  });

  test("a project with its own stale .pi/skills copies does not inflate the count", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-brand-"));
    const skills = path.join(cwd, ".pi", "skills");
    for (const name of ["audit-goodbehavior", "roadmap-goodbehavior", "made-up-goodbehavior", "bridge"]) {
      fs.mkdirSync(path.join(skills, name), { recursive: true });
    }
    process.chdir(cwd);
    const declared = (JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).pi.skills as string[]);
    expect(goodBehaviorSkillCount()).toBe(declared.filter((s) => s.endsWith("-goodbehavior")).length);
  });

  test("the line never claims a GoodBehavior skill it cannot account for", () => {
    expect(ownSkillsLine()).not.toContain("not adopted"); // skills are never 'adopted' — only the profile is
    expect(ownSkillsLine()).toContain("bridge");
  });
});
