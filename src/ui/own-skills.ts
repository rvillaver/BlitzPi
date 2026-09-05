/**
 * Which of BlitzPi's skills are actually ours. Deliberately dependency-light —
 * no `sandbox-bash.ts` import chain, so this stays unit-testable: that file has a real runtime import from an
 * ESM-only package with no CJS `require` condition, which Jest's CJS resolver can never satisfy — nothing has
 * ever unit-tested it directly, and this module must not become the first thing that accidentally does.
 */
import fs from "fs";
import path from "path";

/**
 * How many GoodBehavior skills Pi actually loads this session.
 *
 * Counted from what the INSTALL declares (`package.json` → `pi.skills`), not from `<cwd>/.pi/skills`. Reading the
 * project directory made this line lie: skills written during `session_start` appear on disk but Pi has already
 * finished its one-and-only skill scan, so a freshly set-up folder reported "7 GoodBehavior" in a session where
 * ctrl+o listed none of them (ONBOARDING-SETUP S4a). Package skills are served from the install in every session,
 * so the declaration is the truth — and still read live, so the line can't drift when a skill is added or removed.
 */
export function goodBehaviorSkillCount(): number {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")) as { pi?: { skills?: string[] } };
    return (pkg.pi?.skills ?? []).filter((s) => s.endsWith("-goodbehavior")).length;
  } catch { return 0; }
}

/** BlitzPi's own skills are one flat, unlabeled line among third-party bundled ones in the stock [Skills] panel
 *  (rendered by pi-cc-extensions, not us) — this line is the one place BlitzPi states plainly which are ours. */
export function ownSkillsLine(): string {
  const n = goodBehaviorSkillCount();
  // The old fallback said "GoodBehavior not adopted in this project yet" — the same skills/adoption conflation
  // audit 09 (H2) called out. Skills ship with BlitzPi and are never adopted; only the *profile* is per-project.
  return n > 0
    ? `BlitzPi's own skills: ${n} GoodBehavior + bridge — the agent invokes these on its own when a request matches; anything else in [Skills] is a bundled extension, not ours`
    : "BlitzPi's own skills: bridge — the agent invokes it on its own when a request matches; anything else in [Skills] is a bundled extension, not ours";
}
