/**
 * Adopt the GoodBehavior framework INTO a project: copy the skill definitions from the install's
 * .pi/skills into <project>/.pi/skills and create <project>/.blitz/goodbehavior/memory. Called from the
 * workspace initialization (auto), not a user command.
 */
import fs from "node:fs";
import path from "node:path";

const GB_SKILLS = [
  "audit-goodbehavior", "roadmap-goodbehavior", "gate-build-goodbehavior",
  "verify-goodbehavior", "learn-goodbehavior", "uatplan-goodbehavior", "update-goodbehavior",
];

function installSkillsDir(): string {
  return path.join(__dirname, "..", ".pi", "skills");
}
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

export function isAdopted(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, ".pi", "skills", "audit-goodbehavior", "SKILL.md"));
}

/** Copy the GoodBehavior skills + memory into the project. Returns how many skills were copied. */
export function adoptGoodBehavior(cwd: string): number {
  const src = installSkillsDir();
  if (!fs.existsSync(src)) return 0;
  const destSkills = path.join(cwd, ".pi", "skills");
  let copied = 0;
  for (const name of GB_SKILLS) {
    const s = path.join(src, name);
    if (fs.existsSync(path.join(s, "SKILL.md"))) { copyDir(s, path.join(destSkills, name)); copied++; }
  }
  const memDir = path.join(cwd, ".blitz", "goodbehavior", "memory");
  fs.mkdirSync(memDir, { recursive: true });
  const memIndex = path.join(memDir, "MEMORY.md");
  if (!fs.existsSync(memIndex)) fs.writeFileSync(memIndex, "# Project Memory\n\nDurable learnings for this project.\n");
  return copied;
}
