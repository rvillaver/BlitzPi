/**
 * GoodBehavior Configuration for Pi
 *
 * Sets up .pi/goodbehavior directories and manifest
 */

import * as fs from "fs";
import * as path from "path";

export interface GoodBehaviorConfig {
  piDir: string;
  gbDir: string;
  auditDir: string;
  memoryDir: string;
  profilesDir: string;
}

export function setupGoodBehaviorDirs(piDir: string): GoodBehaviorConfig {
  const gbDir = path.join(piDir, "goodbehavior");
  const auditDir = path.join(piDir, "audit");
  const memoryDir = path.join(gbDir, "memory");
  const profilesDir = path.join(gbDir, "profiles");

  // Create directories if they don't exist
  for (const dir of [gbDir, auditDir, memoryDir, profilesDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Create default manifest if missing
  const manifestPath = path.join(gbDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    const manifest = {
      source: "blitzpi",
      sourceVersion: "1.0.0",
      installedAt: new Date().toISOString(),
      skills: [
        "audit-goodbehavior",
        "roadmap-goodbehavior",
        "gate-build-goodbehavior",
        "verify-goodbehavior",
        "learn-goodbehavior",
        "uatplan-goodbehavior",
        "update-goodbehavior",
      ],
      hooks: ["done-gate"],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  // Create default development profile if missing
  const profilePath = path.join(profilesDir, "development.md");
  if (!fs.existsSync(profilePath)) {
    const profile = `# GoodBehavior Development Profile

This is the default profile for BlitzPi development.

## Audit Scope
- Code quality
- Test coverage
- Security implications
- Performance impact

## Verify Level
- Live testing required
- All 4 checkpoints must fire
- Audit trail shows enforcement

## Gate Rules
- No unverified claims
- Evidence required before "done"
- Learnings recorded per phase
`;
    fs.writeFileSync(profilePath, profile);
  }

  return { piDir, gbDir, auditDir, memoryDir, profilesDir };
}

export function getGoodBehaviorConfig(piDir: string): GoodBehaviorConfig {
  return {
    piDir,
    gbDir: path.join(piDir, "goodbehavior"),
    auditDir: path.join(piDir, "audit"),
    memoryDir: path.join(piDir, "goodbehavior", "memory"),
    profilesDir: path.join(piDir, "goodbehavior", "profiles"),
  };
}
