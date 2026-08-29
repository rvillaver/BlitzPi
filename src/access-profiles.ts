import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { stats } from "./security-status";
import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import { minimatch } from "minimatch";
import { BlitzConfig } from "./config";
import { AuditLogger } from "./audit";
import { debug } from "./log";

// Profile schema
export interface ProfileRule {
  tool: string;
  allowed_paths?: string[];
  denied?: boolean;
  allowed?: boolean;
}

export interface AccessProfile {
  name: string;
  description?: string;
  rules: ProfileRule[];
}

// Built-in fallback so BlitzPi is usable in any workspace even with no .blitz/profiles/ on disk.
// This layer governs WHICH tools may run; file paths are confined by the sandbox and bash by the guard.
const BUILTIN_DEFAULT_PROFILE: AccessProfile = {
  name: "default",
  description: "Built-in default — allow all tools (sandbox + bash guard do the confining)",
  rules: [{ tool: "*", allowed: true }],
};

class ProfileMatcher {
  private profiles: Map<string, AccessProfile> = new Map();
  private currentProfileName: string;

  constructor(
    profilesDir: string,
    defaultProfileName: string,
    private auditLogger: AuditLogger
  ) {
    this.currentProfileName = defaultProfileName;
    this.profiles.set(BUILTIN_DEFAULT_PROFILE.name, BUILTIN_DEFAULT_PROFILE);
    this.loadProfiles(profilesDir);
  }

  private loadProfiles(profilesDir: string): void {
    if (!fs.existsSync(profilesDir)) {
      console.log(
        `[Blitz:AccessProfiles] Profiles directory not found: ${profilesDir}`
      );
      return;
    }

    const files = fs.readdirSync(profilesDir).filter((f) => f.endsWith(".yaml"));

    for (const file of files) {
      const filePath = path.join(profilesDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const profile = load(content) as unknown;
        const parsed = profile as AccessProfile;

        if (parsed.name && parsed.rules) {
          this.profiles.set(parsed.name, parsed);
          console.log(
            `[Blitz:AccessProfiles] Loaded profile: ${parsed.name} (${parsed.rules.length} rules)`
          );
        }
      } catch (error) {
        console.error(
          `[Blitz:AccessProfiles] Failed to load profile ${file}:`,
          error
        );
      }
    }
  }

  private getProfile(): AccessProfile {
    return (
      this.profiles.get(this.currentProfileName) ||
      this.profiles.get(BUILTIN_DEFAULT_PROFILE.name) ||
      BUILTIN_DEFAULT_PROFILE
    );
  }

  private matchesPath(pattern: string, actualPath: string): boolean {
    // Resolve both to absolute paths for comparison
    const resolvedPattern = path.resolve(pattern);
    const resolvedPath = path.resolve(actualPath);

    // Use minimatch for glob pattern matching
    return minimatch(resolvedPath, resolvedPattern, {
      noglobstar: false,
      dot: true,
    });
  }

  private extractPaths(
    toolName: string,
    input: Record<string, unknown>
  ): string[] {
    const paths: string[] = [];

    switch (toolName) {
      case "read":
      case "write":
      case "edit":
        if (input.path && typeof input.path === "string") {
          paths.push(input.path);
        }
        break;
      case "bash":
      case "powershell":
        // Shell commands may reference paths implicitly
        // For now, we don't extract them as they're harder to parse
        break;
      case "find":
      case "grep":
      case "ls":
        if (input.path && typeof input.path === "string") {
          paths.push(input.path);
        }
        break;
    }

    return paths;
  }

  match(event: ToolCallEvent): { allowed: boolean; reason?: string } {
    const profile = this.getProfile();
    const toolName = event.toolName;
    const input = event.input as Record<string, unknown>;

    // Find matching rule for this tool
    for (const rule of profile.rules) {
      if (rule.tool === "*" || rule.tool === toolName) {
        // Check if tool is explicitly denied
        if (rule.denied === true) {
          return { allowed: false, reason: `Tool '${toolName}' denied by profile` };
        }

        // Access profiles govern WHICH tools may run. File paths are confined by the permission gate
        // (zones), so allowed_paths on a rule is ignored here to avoid double-enforcement/conflicts.
        return { allowed: true };
      }
    }

    // No matching rule found - deny by default
    return {
      allowed: false,
      reason: `No rule found for tool '${toolName}' in profile '${profile.name}'`,
    };
  }
}

export function setupAccessProfiles(
  pi: ExtensionAPI,
  config: BlitzConfig,
  auditLogger: AuditLogger
): void {
  console.log("[Blitz:AccessProfiles] Setup");
  console.log("[Blitz:AccessProfiles] Integrating Blitz access profiles with Pi permission system");

  // Determine profile directories to check
  const profileDirs = [
    path.join(process.cwd(), ".blitz", "profiles"),
    path.join(process.env.HOME || require("os").homedir(), ".blitz", "profiles"),
  ];

  // Use first directory that exists
  const profilesDir = profileDirs.find((dir) => fs.existsSync(dir)) || profileDirs[0];

  const matcher = new ProfileMatcher(
    profilesDir,
    config.profiles.default,
    auditLogger
  );

  // Register tool_call hook to enforce access profiles
  // This integrates with Pi's permission system - all tool calls pass through here
  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    // Match against Blitz access profiles
    const decision = matcher.match(event);

    // Always log the decision
    auditLogger.log({
      type: "access_profile_check",
      tool: event.toolName,
      toolCallId: event.toolCallId,
      allowed: decision.allowed,
      reason: decision.reason,
      profile: config.profiles.default,
    });

    // Block if not allowed
    if (!decision.allowed) {
      debug(`AccessProfiles BLOCKED ${event.toolName}: ${decision.reason}`);
      stats.blocked.profile++;
      return {
        block: true,
        reason: `[PROFILE DENIED] ${decision.reason}`,
      } as ToolCallEventResult;
    }

    debug(`AccessProfiles ALLOWED ${event.toolName}`);
  });

  console.log(
    `[Blitz:AccessProfiles] Listening on profile: ${config.profiles.default}`
  );
}
