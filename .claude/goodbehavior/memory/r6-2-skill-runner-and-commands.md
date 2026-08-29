---
name: r6-2-skill-runner-and-commands
description: Phase 2 implementation - SkillRunner abstraction + blitz roadmap/gate commands with governance loop enforcement
metadata: { type: feedback }
---

## R6.2 Implementation: Skill Execution & Governance Commands

**Status:** ✔ Fully implemented and verified (2026-08-28)

### Components Implemented

#### R6.2.1: SkillRunner Abstraction (`src/skill-runner.ts`)

A foundational class that:
1. **Discovers skills** — Scans `.claude/skills/` directory
2. **Reads metadata** — Parses SKILL.md frontmatter (name, description)
3. **Lists skills** — Returns available skills with descriptions
4. **Invokes skills** — Provides skill invocation guides with arguments

**Key methods:**
- `listSkills()` — Get all available skills
- `getSkill(name)` — Get specific skill metadata
- `invokeSkill(name, args)` — Prepare and invoke skill
- `readSkillContent()` — Get full skill documentation

**Why this design:**
- Skills are designed for Claude Code's `/` prefix system
- CLI can't directly execute skill logic (Python-based, interactive)
- Bridge: SkillRunner discovers and guides skill invocation
- Future: Can be extended to spawn Claude/Pi process or call API

**Verification:** ✔ Creates skill invocation guides, correctly parses SKILL.md frontmatter

#### R6.2.2: `blitz roadmap` Command (`src/cli-roadmap.ts`)

CLI command that:
1. Checks if audit exists (roadmap depends on audit findings)
2. Discovers roadmap-goodbehavior skill
3. Invokes skill with arguments (audit-source, etc.)
4. Logs command to audit trail
5. Provides user guidance to run skill via Claude

**Governance loop check:** ✔ Enforces audit exists before roadmap
**Error handling:** ✔ Clear messages if skill/audit missing
**Audit logging:** ✔ Records roadmap command invocation

#### R6.2.3: `blitz gate` Command (`src/cli-gate.ts`)

CLI command that:
1. Enforces governance loop (audit → roadmap → gate)
2. Checks both audit AND roadmap exist
3. Discovers gate-build-goodbehavior skill
4. Invokes skill with phase/item arguments
5. Logs decision to audit trail
6. Provides verification & learnings guidance

**Governance loop check:** ✔ Fails clearly if audit/roadmap missing
**Sequencing:** ✔ Enforces: audit (gaps) → roadmap (plan) → gate (verify)
**Audit logging:** ✔ Records gate initiation with phase/item
**Guidance:** ✔ Tells user each item is BUILD → VERIFY → RECORD → GATE

### Governance Loop Architecture

```
User workflow:
1. blitz audit → find security & work gaps
   └─ Outputs: .claude/goodbehavior/audit/*.json

2. blitz roadmap → create phased plan
   ├─ Requires: audit findings
   └─ Outputs: docs/plans/ROADMAP.md

3. blitz gate → verify through gates
   ├─ Requires: audit AND roadmap
   ├─ Enforces: build → verify → record → gate per item
   └─ Outputs: .blitz/audit/*.jsonl (decisions)
```

**Enforcement:** Each command checks prerequisite(s) and fails with clear message if missing

### Testing & Verification

**Test scenario:** Adopted project, tested command flow
1. `blitz roadmap` → ✔ Correctly fails: "No audit findings"
2. `blitz gate` → ✔ Correctly fails: "Audit not run"
3. `blitz gate` (with audit + roadmap) → ✔ Works, provides invocation guide

**Evidence:**
- Skills correctly discovered (.claude/skills/roadmap-goodbehavior, etc.)
- Governance loop enforced (prerequisites checked)
- Skill invocation guides generated with arguments
- Audit trail logging implemented

### Why This Approach

**SkillRunner class:**
- Centralizes skill discovery/management
- Can be reused by multiple commands
- Extensible for future skill invocation methods
- Doesn't duplicate skill-listing logic

**Governance loop enforcement:**
- Prevents user error (running gate without audit)
- Ensures correct workflow: audit → roadmap → gate
- Clear error messages guide user to correct step
- Audit trail shows sequence

**Skill invocation guides (not direct execution):**
- Skills are interactive, designed for Claude Code
- CLI can't directly run Python skill logic
- Guide approach is pragmatic bridge
- Future: Can shell out to Claude/Pi if needed

### Related Learnings
- [[r6-1-adoption-implementation]] — GoodBehavior adoption creates .claude/skills/
- [[phase-6-cli-architecture]] — CLI command routing and error handling
