---
name: r6-1-adoption-implementation
description: blitz init --goodbehavior command creates destination project structure with both Blitz security + GoodBehavior framework
metadata: { type: feedback }
---

## R6.1.1 Implementation: `blitz init --goodbehavior` Adoption

**Status:** ✔ Fully implemented and verified (2026-08-28)

### What It Does
The `blitz install --goodbehavior /path/to/destination` command adopts both the Blitz security layer AND the GoodBehavior governance framework to any destination project in a single step.

### Files/Dirs Created in Destination

After running the command, the destination project receives:

**Security layer (.blitz/):**
- `.blitz/blitz.config.yaml` — Project-specific Blitz security config (threat detection tier, audit paths, profiles, sandbox, governance API endpoints)
- `.blitz/profiles/user.yaml` — Default profile (allows all tools by default)
- `.blitz/audit/` — Empty directory for audit logs

**Governance framework (.claude/):**
- `.claude/skills/` — All 7 GoodBehavior skills copied:
  - audit-goodbehavior
  - roadmap-goodbehavior
  - gate-build-goodbehavior
  - verify-goodbehavior
  - learn-goodbehavior
  - update-goodbehavior
  - uatplan-goodbehavior
- `.claude/goodbehavior/` — Work tracking structure:
  - `audit/` — Audit findings
  - `roadmap/` — Phased roadmap
  - `gate/` — Gate decisions
  - `manifest.json` — Project metadata (name, version, framework, blitz_enabled flag, created_at timestamp)
- `.claude/settings.json` — Pi auto-load config (adds Blitz extension path to extensions array)

### Verification Method
Tested with simulated user project ("soul-chat-app"). Adopted the project, verified:
1. All 11 required files/directories exist
2. Config files are readable and contain expected sections
3. All 7 skills are present with SKILL.md metadata
4. manifest.json has blitz_enabled = true
5. settings.json has extensions array configured

**Result:** ✔ ALL CHECKS PASSED

### Implementation Details

**Location:** `src/install.ts` - `adoptGoodBehaviorFramework()` function

**Key steps in order:**
1. Create `.blitz/` with audit and profiles subdirs (lines 150-154)
2. Create `.claude/skills/` and copy all skill directories recursively (lines 165-172)
3. Create `.claude/goodbehavior/` with audit/roadmap/gate subdirs (lines 175-182)
4. Write `.claude/goodbehavior/manifest.json` with project metadata (lines 184-195)
5. Write `.blitz/blitz.config.yaml` to destination with security defaults (lines 198-220)
6. Write `.blitz/profiles/user.yaml` default profile (lines 223-230)
7. Configure `.claude/settings.json` for Pi auto-load (lines 232-242)

### Why This Approach

**Single command:** User runs `blitz init --goodbehavior /path` and gets both frameworks set up — no separate installation steps.

**Recursive copy for skills:** Uses `copyDirectory()` helper to copy entire skill directories with all metadata (SKILL.md files).

**Project-local config:** Each adopted project gets its own `.blitz/config` so security settings can vary per-project.

**Pi auto-load:** Adds extension path to `.claude/settings.json` so Pi automatically loads Blitz when the project runs Claude Code commands.

**Manifest tracking:** `.claude/goodbehavior/manifest.json` marks that Blitz is enabled in this project (useful for later audits/reports).

### Related Learnings
- [[phase-6-cli-architecture]] — Overall CLI command routing
- [[skill-directory-structure]] — How GoodBehavior skills are organized
