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
import { setupFirstRunFlow } from "./setup";
import { setupBlitzPiBranding } from "./ui/blitzpi-branding";
import { setupCompaction } from "./compaction";
import { setupProjectRegistry } from "./projects-hook";
import { setupFeeds } from "./feeds";
import { setupSecretsFeed } from "./feeds/secrets";
import { setupCommandsFeed } from "./feeds/commands";
import { setupUrlsFeed } from "./feeds/urls";
import { setupContentScan } from "./content-scan";
import { cacheRoot } from "./toolchain-cache";
import { setupQuestionTool } from "./tools/question";
import { setupChannelPostTool } from "./tools/channel-post";
import { setupBridgeCommands } from "./ui/bridge-commands";
import { defaultScratchDirs } from "./zones";
import { info } from "./log";
import { setupLoop } from "./loop";
import { setupInitRecovery, step, type ModuleFailure } from "./init-recovery";

/**
 * Blitz Pi - Security-first coding agent
 * This extension loads as part of the Blitz Pi unified product
 */
export default async function blitz(pi: ExtensionAPI): Promise<void> {
  info("[Blitz Pi] Initializing security layer...");

  // Nothing below throws out of this function. Pi answers a throwing factory with `load.discard()` — every hook
  // this extension registered is dropped and the session continues — so for the extension whose job is
  // confinement, throwing means handing back a working agent with no security layer (audit 14, G14-1). Failures
  // are collected and answered by setupInitRecovery, with actions scaled to how bad they are.
  const failures: ModuleFailure[] = [];
  const core: { failed: string | null } = { failed: null };
  // Registered before anything else so its dialog is not queued behind another extension's blocking prompt.
  setupInitRecovery(pi, failures, core);

  try {
    const caller = initializeCaller();
    const config = loadConfig();
    const auditLogger = setupAudit(caller, config);

    info(`[Blitz Pi] Caller: ${caller.user} (${caller.install_type}) in ${caller.project_path}`);
    info(`[Blitz Pi] Threat detection tier: ${config.threat_detection.tier}`);
    info(`[Blitz Pi] Security level: ${config.security_level}`);

    // Permission gate (zones + ladder). Project = launch folder; install = BlitzPi's own dir.
    const projectRoot = process.cwd();
    const installRoot = path.join(__dirname, "..");
    const memory = new PermissionMemory(defaultPermissionStore(projectRoot));
    // The toolchain cache root counts as scratch for the guard: package managers write there on every install.
    const cache = cacheRoot(config.sandbox.cache ?? "shared", projectRoot);
    const gate = new PermissionGate({ project: projectRoot, install: installRoot, scratch: [...defaultScratchDirs(), ...(cache ? [cache] : [])] }, memory, auditLogger, config.security_level);

    // --- enforcement: the session must not run without these ---
    step(failures, "threat detection", true, () => setupThreatDetection(pi, config, auditLogger));
    step(failures, "access profiles", true, () => setupAccessProfiles(pi, config, auditLogger));
    step(failures, "governance", true, () => setupGovernance(pi, config, auditLogger, caller));
    step(failures, "file sandbox", true, () => setupSandbox(pi, config, auditLogger, gate));
    step(failures, "bash sandbox", true, () => setupSandboxedBash(pi, config, auditLogger, gate));

    // --- detection feeds: opt-in by design, so running without them is a supported state ---
    step(failures, "package feed", false, () => setupFeeds(pi, config, auditLogger)); // before the bash gate: a known-malicious install is refused, not asked about
    step(failures, "secrets feed", false, () => setupSecretsFeed(pi, config, auditLogger));
    step(failures, "commands feed", false, () => setupCommandsFeed(pi, config, auditLogger));
    step(failures, "urls feed", false, () => setupUrlsFeed(pi, config, auditLogger));
    step(failures, "content scan", false, () => setupContentScan(pi, config, auditLogger));

    // --- everything else: a failure here costs that feature and nothing more ---
    step(failures, "goodbehavior", false, () => setupGoodBehavior(pi, config));
    step(failures, "setup flow", false, () => setupFirstRunFlow(pi, auditLogger));
    step(failures, "project registry", false, () => setupProjectRegistry(pi, config));
    step(failures, "compaction", false, () => setupCompaction(pi, auditLogger));
    step(failures, "branding", false, () => setupBlitzPiBranding(pi, config, auditLogger));
    step(failures, "question tool", false, () => setupQuestionTool(pi));
    step(failures, "channel post tool", false, () => setupChannelPostTool(pi));
    step(failures, "bridge commands", false, () => setupBridgeCommands(pi));
    step(failures, "loop", false, () => setupLoop(pi));
  } catch (error) {
    // Core init (caller / config / audit / permission gate). Nothing security-related got registered.
    core.failed = error instanceof Error ? error.message : String(error);
  }

  const broken = failures.filter((f) => f.critical).length;
  info(core.failed || broken ? `[Blitz Pi] Security layer INCOMPLETE — see the message above` : "[Blitz Pi] Security layer ready");
}
