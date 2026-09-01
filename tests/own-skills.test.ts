/**
 * UX-2: BlitzPi's own header/banner states plainly which skills are its own (GoodBehavior + bridge) vs. the
 * third-party ones the stock [Skills] panel (rendered by pi-cc-extensions, not us) lists alongside them.
 * Count is read live from .pi/skills/*-goodbehavior, never hard-coded, so it can't drift.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { goodBehaviorSkillCount, ownSkillsLine } from "../src/ui/own-skills";

describe("goodBehaviorSkillCount / ownSkillsLine", () => {
  const origCwd = process.cwd();
  afterEach(() => process.chdir(origCwd));

  test("no .pi/skills at all -> 0, 'not adopted' message", () => {
    process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-brand-")));
    expect(goodBehaviorSkillCount()).toBe(0);
    expect(ownSkillsLine()).toBe("GoodBehavior not adopted in this project yet — /adopt-goodbehavior");
  });

  test("some skills present, only -goodbehavior suffixed ones count (bridge and others excluded)", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-brand-"));
    const skills = path.join(cwd, ".pi", "skills");
    for (const name of ["audit-goodbehavior", "roadmap-goodbehavior", "gate-build-goodbehavior", "bridge", "mcp-scripting"]) {
      fs.mkdirSync(path.join(skills, name), { recursive: true });
    }
    process.chdir(cwd);
    expect(goodBehaviorSkillCount()).toBe(3);
    expect(ownSkillsLine()).toBe("BlitzPi's own skills: 3 GoodBehavior (manual, /skill:name) + bridge (auto-triggers) — anything else in [Skills] is a bundled extension, not ours");
  });
});
