import fs from "fs";
import path from "path";
import { load } from "js-yaml";

export interface BlitzConfig {
  threat_detection: {
    enabled: boolean;
    tier: 1 | 2 | 3 | 4;
    /** Scan tool RESULTS (what the agent reads) for instruction-shaped text — monitor only, never blocks. */
    content: "monitor" | "off";
  };
  audit: {
    enabled: boolean;
    path: string;
  };
  profiles: {
    default: string;
  };
  sandbox: {
    enabled: boolean;
    run_dir: string;
    backend?: "auto" | "bwrap" | "sandbox-exec" | "pinned" | "none";
    /** Where package managers cache under the sandbox: shared (~/.blitz/cache, default) | project (<project>/.blitz/cache) | off. */
    cache: "shared" | "project" | "off";
  };
  governance: {
    enabled: boolean;
    /** enforce = a denied model call is stopped (the run is aborted); monitor = recorded and shown only. */
    mode: "enforce" | "monitor";
    provider: "local" | "custom" | "openai-moderation" | "guardrails";
    model_whitelist?: string[];
    api_endpoint?: string;
    openai_api_key?: string;
    guardrails_endpoint?: string;
  };
  goodbehavior: {
    profile: string; // active GoodBehavior profile name (.blitz/goodbehavior/profiles/<name>.md)
  };
  threat_api: {
    enabled: boolean;
    api_endpoint: string;
  };
  feeds: {
    /** Package feed (OSV): enforce = a known-malicious package install is blocked; monitor = recorded and shown. */
    packages: "enforce" | "monitor" | "off";
    /** Secrets feed (gitleaks rules, opt-in download): a credential literal in a command. Default monitor. */
    secrets: "enforce" | "monitor" | "off";
    /** Command-shapes feed (Sigma rules, opt-in download): reverse shells, download-and-execute … Default monitor. */
    commands: "enforce" | "monitor" | "off";
    /** Rule ids (Sigma / gitleaks) this project accepts as known false positives: their hits are neither recorded nor shown. */
    allow: string[];
    /** URL feed (URLhaus, opt-in download): a URL in a command that is listed as distributing malware. Default monitor. */
    urls: "enforce" | "monitor" | "off";
    cache_ttl_hours: number;
  };
}

function getDefaultRunDir(): string {
  // The workspace is the project the user launched BlitzPi in. File tools and the bash sandbox
  // are confined to it (audit gap 12.4: the old timestamped ./runs dir blocked reading the project).
  return process.env.BLITZ_RUN_DIR || process.cwd();
}

const DEFAULT_CONFIG: BlitzConfig = {
  threat_detection: {
    enabled: true,
    tier: 2, // command-injection tier; 3-4 add aggressive heuristics (more false positives on normal bash)
    content: "monitor",
  },
  audit: {
    enabled: true,
    path: process.env.BLITZ_AUDIT_PATH || getDefaultAuditPath(),
  },
  profiles: {
    default: "user",
  },
  sandbox: {
    enabled: true,
    run_dir: getDefaultRunDir(),
    backend: (process.env.BLITZ_SANDBOX_BACKEND as any) || "auto",
    cache: "shared",
  },
  governance: {
    enabled: true,
    mode: "enforce",
    provider: (process.env.BLITZ_GOVERNANCE_PROVIDER as any) || "local",
    api_endpoint: process.env.BLITZ_GOVERNANCE_API,
    openai_api_key: process.env.OPENAI_API_KEY,
    guardrails_endpoint: process.env.BLITZ_GUARDRAILS_ENDPOINT,
  },
  goodbehavior: {
    profile: "development",
  },
  threat_api: {
    enabled: false,
    api_endpoint: process.env.BLITZ_THREAT_API || "http://localhost:9001/threat/check",
  },
  feeds: {
    packages: "enforce",
    secrets: "monitor",
    commands: "monitor",
    urls: "monitor",
    allow: [],
    cache_ttl_hours: 24,
  },
};

function expandTilde(p: string): string {
  if (p === "~") return process.env.HOME || os.homedir();
  if (p.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), p.slice(2));
  return p;
}

function getDefaultAuditPath(): string {
  // Audit trail is GLOBAL (cross-project security record), in the user's home — not the project.
  return path.join(process.env.HOME || os.homedir(), ".blitz", "audit");
}

function detectInstallTypeForConfig(): "global" | "local" {
  const scriptDir = __dirname;
  return scriptDir.includes("/usr/") || scriptDir.includes("/.npm/") ? "global" : "local";
}

export function loadConfig(): BlitzConfig {
  let config: BlitzConfig;

  // Check project-local config first
  const localConfigPath = path.join(process.cwd(), ".blitz", "blitz.config.yaml");
  if (fs.existsSync(localConfigPath)) {
    config = loadYamlConfig(localConfigPath);
  } else {
    // Check global config
    const globalConfigPath = path.join(process.env.HOME || os.homedir(), ".blitz", "blitz.config.yaml");
    if (fs.existsSync(globalConfigPath)) {
      config = loadYamlConfig(globalConfigPath);
    } else {
      // Use defaults
      config = DEFAULT_CONFIG;
    }
  }

  // Ensure run directory exists
  if (config.sandbox.enabled) {
    if (!fs.existsSync(config.sandbox.run_dir)) {
      fs.mkdirSync(config.sandbox.run_dir, { recursive: true });
    }
  }

  return config;
}

function loadYamlConfig(filePath: string): BlitzConfig {
  const content = fs.readFileSync(filePath, "utf-8");
  const parsed = load(content) as unknown;
  return validateConfig(parsed as Partial<BlitzConfig>);
}

function validateConfig(config: Partial<BlitzConfig>): BlitzConfig {
  // Merge with defaults
  return {
    threat_detection: {
      enabled: config.threat_detection?.enabled ?? DEFAULT_CONFIG.threat_detection.enabled,
      tier: validateTier(config.threat_detection?.tier ?? DEFAULT_CONFIG.threat_detection.tier),
      content: config.threat_detection?.content === "off" ? "off" : "monitor",
    },
    audit: {
      enabled: config.audit?.enabled ?? DEFAULT_CONFIG.audit.enabled,
      path: expandTilde((config.audit?.path as string) ?? DEFAULT_CONFIG.audit.path),
    },
    profiles: {
      default: (config.profiles?.default as string) ?? DEFAULT_CONFIG.profiles.default,
    },
    sandbox: {
      enabled: config.sandbox?.enabled ?? DEFAULT_CONFIG.sandbox.enabled,
      run_dir: expandTilde((config.sandbox?.run_dir as string) ?? DEFAULT_CONFIG.sandbox.run_dir),
      backend: (config.sandbox?.backend as any) ?? DEFAULT_CONFIG.sandbox.backend,
      cache: (["shared", "project", "off"] as const).find((m) => m === config.sandbox?.cache) ?? DEFAULT_CONFIG.sandbox.cache,
    },
    governance: {
      enabled: config.governance?.enabled ?? DEFAULT_CONFIG.governance.enabled,
      mode: config.governance?.mode === "monitor" ? "monitor" : "enforce",
      provider: (config.governance?.provider as any) ?? DEFAULT_CONFIG.governance.provider,
      model_whitelist: (config.governance?.model_whitelist as string[]) ?? DEFAULT_CONFIG.governance.model_whitelist,
      api_endpoint: (config.governance?.api_endpoint as string) ?? DEFAULT_CONFIG.governance.api_endpoint,
      openai_api_key: (config.governance?.openai_api_key as string) ?? DEFAULT_CONFIG.governance.openai_api_key,
      guardrails_endpoint: (config.governance?.guardrails_endpoint as string) ?? DEFAULT_CONFIG.governance.guardrails_endpoint,
    },
    goodbehavior: {
      profile: (config.goodbehavior?.profile as string) ?? DEFAULT_CONFIG.goodbehavior.profile,
    },
    threat_api: {
      enabled: config.threat_api?.enabled ?? DEFAULT_CONFIG.threat_api.enabled,
      api_endpoint: (config.threat_api?.api_endpoint as string) ?? DEFAULT_CONFIG.threat_api.api_endpoint,
    },
    feeds: {
      packages: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.packages) ?? DEFAULT_CONFIG.feeds.packages,
      secrets: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.secrets) ?? DEFAULT_CONFIG.feeds.secrets,
      commands: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.commands) ?? DEFAULT_CONFIG.feeds.commands,
      urls: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.urls) ?? DEFAULT_CONFIG.feeds.urls,
      allow: Array.isArray(config.feeds?.allow) ? (config.feeds.allow as unknown[]).filter((x): x is string => typeof x === "string") : DEFAULT_CONFIG.feeds.allow,
      cache_ttl_hours: typeof config.feeds?.cache_ttl_hours === "number" ? config.feeds.cache_ttl_hours : DEFAULT_CONFIG.feeds.cache_ttl_hours,
    },
  };
}

function validateTier(tier: unknown): 1 | 2 | 3 | 4 {
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4) {
    return tier;
  }
  return DEFAULT_CONFIG.threat_detection.tier;
}

import os from "os";
