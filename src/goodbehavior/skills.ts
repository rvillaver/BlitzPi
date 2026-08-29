/**
 * GoodBehavior Skills Registration for Pi
 *
 * Pre-installs GoodBehavior skills so users can invoke them immediately
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";

export interface SkillDefinition {
  name: string;
  command: string;
  description: string;
}

const GOODBEHAVIOR_SKILLS: SkillDefinition[] = [
  {
    name: "audit-goodbehavior",
    command: "Catalog gaps between current state and reference (code, features, behavior)",
    description: "Find and document what's missing or broken",
  },
  {
    name: "roadmap-goodbehavior",
    command: "Turn gaps into an ordered plan with phases and items",
    description: "Create actionable roadmap from audit findings",
  },
  {
    name: "gate-build-goodbehavior",
    command: "Build one roadmap item end-to-end: code → verify live → record learning → gate",
    description: "Execute and verify implementation with evidence",
  },
  {
    name: "verify-goodbehavior",
    command: "Exercise the real thing the way its consumer would; capture evidence",
    description: "Verify live behavior, not just tests",
  },
  {
    name: "learn-goodbehavior",
    command: "Record learnings: non-obvious traps, corrections, build/deploy facts",
    description: "Persist discoveries to memory for future sessions",
  },
  {
    name: "uatplan-goodbehavior",
    command: "Create user acceptance test plan for the deliverable",
    description: "Plan how to verify with users",
  },
  {
    name: "update-goodbehavior",
    command: "Update roadmap, learning record, or backlog with new findings",
    description: "Keep planning documents current",
  },
];

/**
 * GoodBehavior skills are adopted per-project via /adopt-goodbehavior (copied from the install, proper
 * SKILL.md frontmatter) and are loaded by Pi itself. Nothing is written into the user's project.
 */
export function registerGoodBehaviorSkills(_pi: ExtensionAPI, _unused?: string): SkillDefinition[] {
  return GOODBEHAVIOR_SKILLS;
}
