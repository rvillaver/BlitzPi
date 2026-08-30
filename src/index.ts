import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { initializeCaller } from "./caller";
import { loadConfig } from "./config";
import { setupThreatDetection } from "./threat-detection";
import { setupAccessProfiles } from "./access-profiles";
import { setupGovernance } from "./governance";
import { setupSandbox } from "./sandbox";
import { setupSandboxedBash } from "./sandbox-bash";
import { PermissionGate } from "./permission-gate";
import { PermissionMemory, defaultPermissionStore } from "./permissions";
import path from "node:path";
import { setupAudit } from "./audit";
import { setupGoodBehavior } from "./goodbehavior";
import { setupWorkspaceInit } from "./workspace-init";
import { setupBlitzPiBranding } from "./ui/blitzpi-branding";
import { setupCompaction } from "./compaction";
import { setupProjectRegistry } from "./projects-hook";
import { setupFeeds } from "./feeds";
import { setupSecretsFeed } from "./feeds/secrets";
import { setupCommandsFeed } from "./feeds/commands";
import { setupUrlsFeed } from "./feeds/urls";
import { setupContentScan } from "./content-scan";
import { setupFeedsOnboarding } from "./feeds/onboard";
import { cacheRoot } from "./toolchain-cache";
import { defaultScratchDirs } from "./zones";

/**
 * Blitz Pi - Security-first coding agent
 * This extension loads as part of the Blitz Pi unified product
 */
export default async function blitz(pi: ExtensionAPI): Promise<void> {
  console.log("[Blitz Pi] Initializing security layer...");

  try {
    // Phase 1: Core initialization
    const caller = initializeCaller();
    const config = loadConfig();
    const auditLogger = setupAudit(caller, config);

    console.log(`[Blitz Pi] Caller: ${caller.user} (${caller.install_type}) in ${caller.project_path}`);
    console.log(`[Blitz Pi] Threat detection tier: ${config.threat_detection.tier}`);

    // Permission gate (zones + ladder). Project = launch folder; install = BlitzPi's own dir.
    const projectRoot = process.cwd();
    const installRoot = path.join(__dirname, "..");
    const memory = new PermissionMemory(defaultPermissionStore(projectRoot));
    // The toolchain cache root counts as scratch for the guard: package managers write there on every install.
    const cache = cacheRoot(config.sandbox.cache ?? "shared", projectRoot);
    const gate = new PermissionGate({ project: projectRoot, install: installRoot, scratch: [...defaultScratchDirs(), ...(cache ? [cache] : [])] }, memory, auditLogger);

    // Register checkpoints and providers
    setupThreatDetection(pi, config, auditLogger);
    setupAccessProfiles(pi, config, auditLogger);
    setupGovernance(pi, config, auditLogger, caller);
    setupSandbox(pi, config, auditLogger, gate);
    setupFeeds(pi, config, auditLogger); // before the bash gate: a known-malicious install is refused, not asked about
    setupSecretsFeed(pi, config, auditLogger);
    setupCommandsFeed(pi, config, auditLogger);
    setupUrlsFeed(pi, config, auditLogger);
    setupContentScan(pi, config, auditLogger);
    setupFeedsOnboarding(pi, auditLogger); // asks once per version while undecided; installs in-app
    setupSandboxedBash(pi, config, auditLogger, gate);

    // Phase 3: GoodBehavior (profile → system prompt when adopted; done-gate; adopt/unadopt commands)
    setupGoodBehavior(pi, config);
    setupWorkspaceInit(pi);
    setupProjectRegistry(pi, config);
    setupCompaction(pi, auditLogger);

    // Phase 4: Setup UI & Branding (BlitzPi identity + live status commands)
    setupBlitzPiBranding(pi, config, auditLogger);

    console.log("[Blitz Pi] Security layer ready");
  } catch (error) {
    console.error("[Blitz Pi] Failed to initialize:", error);
    throw error;
  }
}
