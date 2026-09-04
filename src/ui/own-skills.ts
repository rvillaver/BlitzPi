/**
 * Which of BlitzPi's skills are actually ours. Deliberately dependency-light —
 * no `sandbox-bash.ts` import chain, so this stays unit-testable: that file has a real runtime import from an
 * ESM-only package with no CJS `require` condition, which Jest's CJS resolver can never satisfy — nothing has
 * ever unit-tested it directly, and this module must not become the first thing that accidentally does.
 */
import fs from "fs";
import path from "path";

/** How many GoodBehavior doctrine skills are actually active in this project (`.pi/skills/*-goodbehavior`,
 *  synced automatically every session since audit 09 — no adoption command needed) — read live, not
 *  hard-coded, so this line can't drift the moment a skill is added or removed. */
export function goodBehaviorSkillCount(): number {
  try {
    return fs.readdirSync(path.join(process.cwd(), ".pi", "skills")).filter((d) => d.endsWith("-goodbehavior")).length;
  } catch { return 0; }
}

/** BlitzPi's own skills are one flat, unlabeled line among third-party bundled ones in the stock [Skills] panel
 *  (rendered by pi-cc-extensions, not us) — this line is the one place BlitzPi states plainly which are ours. */
export function ownSkillsLine(): string {
  const n = goodBehaviorSkillCount();
  return n > 0
    ? `BlitzPi's own skills: ${n} GoodBehavior + bridge — the agent invokes these on its own when a request matches; anything else in [Skills] is a bundled extension, not ours`
    : "GoodBehavior not adopted in this project yet — /adopt-goodbehavior";
}
