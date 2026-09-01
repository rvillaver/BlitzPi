import fs from "fs";
import path from "path";
import { load } from "js-yaml";
import type { SecurityLevel } from "./permissions";

export interface BlitzConfig {
  /** How much the ladder stops to ask: strict (+asks before installs) | guarded (shipped default) |
   *  monitored (project writes + outside-project reads go silent, still audited). A non-interactive run always
   *  uses `guarded` for the zone ladder regardless of this — see permission-gate.ts. */
  security_level: SecurityLevel;
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
    /** Secrets feed (gitleaks rules, opt-in download): a credential literal in a command. Default enforce (1.2.106). */
    secrets: "enforce" | "monitor" | "off";
    /** Command-shapes feed (Sigma rules, opt-in download): reverse shells, download-and-execute … Default monitor. */
    commands: "enforce" | "monitor" | "off";
    /** Rule ids (Sigma / gitleaks) this project accepts as known false positives: their hits are neither recorded nor shown. */
    allow: string[];
    /** Bun install policy: versions published more recently than this are not selected ("3d" default; "off"). */
    min_release_age: string;
    /** URL feed (URLhaus, opt-in download): a URL in a command that is listed as distributing malware. Default enforce (1.2.106). */
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
  security_level: "guarded",
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
    secrets: "enforce",
    commands: "monitor", // Sigma shapes fire on normal work (touch -t, grep password) — allowlist per project, then flip
    urls: "enforce",
    allow: [],
    min_release_age: "3d",
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

/**
 * Global config sets defaults for every project; a project's own config overrides individual fields on top —
 * it does not replace the global file wholesale. (Before this, a project config short-circuited the global one
 * entirely, so a global-scope default like security_level would silently vanish the moment a project had its
 * own .blitz/blitz.config.yaml, which workspace-init.ts writes for every new project.)
 */
export function loadConfig(): BlitzConfig {
  let config = DEFAULT_CONFIG;
  let globalRaw: Partial<BlitzConfig> | undefined;
  let localRaw: Partial<BlitzConfig> | undefined;

  const globalConfigPath = path.join(process.env.HOME || os.homedir(), ".blitz", "blitz.config.yaml");
  if (fs.existsSync(globalConfigPath)) {
    globalRaw = loadRawYaml(globalConfigPath);
    config = validateConfig(globalRaw, config);
  }

  const localConfigPath = path.join(process.cwd(), ".blitz", "blitz.config.yaml");
  if (fs.existsSync(localConfigPath)) {
    localRaw = loadRawYaml(localConfigPath);
    config = validateConfig(localRaw, config);
  }

  config = applyLevelDefaults(config, globalRaw, localRaw);

  // Ensure run directory exists
  if (config.sandbox.enabled) {
    if (!fs.existsSync(config.sandbox.run_dir)) {
      fs.mkdirSync(config.sandbox.run_dir, { recursive: true });
    }
  }

  return config;
}

/**
 * `monitored` loosens governance and the noisier feeds to `monitor` mode BY DEFAULT — but only for a field
 * neither config layer named explicitly (a project or global override always wins over the tier). This runs
 * after both layers have merged, so it can tell "inherited the built-in enforce default" apart from "someone
 * actually wrote enforce/monitor down".
 */
function applyLevelDefaults(config: BlitzConfig, globalRaw: Partial<BlitzConfig> | undefined, localRaw: Partial<BlitzConfig> | undefined): BlitzConfig {
  if (config.security_level !== "monitored") return config;
  const namedGovernanceMode = globalRaw?.governance?.mode !== undefined || localRaw?.governance?.mode !== undefined;
  const namedSecrets = globalRaw?.feeds?.secrets !== undefined || localRaw?.feeds?.secrets !== undefined;
  const namedUrls = globalRaw?.feeds?.urls !== undefined || localRaw?.feeds?.urls !== undefined;
  return {
    ...config,
    governance: namedGovernanceMode ? config.governance : { ...config.governance, mode: "monitor" },
    feeds: {
      ...config.feeds,
      secrets: namedSecrets ? config.feeds.secrets : "monitor",
      urls: namedUrls ? config.feeds.urls : "monitor",
    },
  };
}

function loadRawYaml(filePath: string): Partial<BlitzConfig> {
  const content = fs.readFileSync(filePath, "utf-8");
  return (load(content) as unknown) as Partial<BlitzConfig>;
}

function validateConfig(config: Partial<BlitzConfig>, base: BlitzConfig = DEFAULT_CONFIG): BlitzConfig {
  // Merge onto `base` (the layer beneath — global config, or the built-in defaults)
  return {
    security_level: (["strict", "guarded", "monitored"] as const).find((m) => m === config.security_level) ?? base.security_level,
    threat_detection: {
      enabled: config.threat_detection?.enabled ?? base.threat_detection.enabled,
      tier: validateTier(config.threat_detection?.tier ?? base.threat_detection.tier, base.threat_detection.tier),
      content: config.threat_detection?.content === "off" ? "off" : config.threat_detection?.content === "monitor" ? "monitor" : base.threat_detection.content,
    },
    audit: {
      enabled: config.audit?.enabled ?? base.audit.enabled,
      path: expandTilde((config.audit?.path as string) ?? base.audit.path),
    },
    profiles: {
      default: (config.profiles?.default as string) ?? base.profiles.default,
    },
    sandbox: {
      enabled: config.sandbox?.enabled ?? base.sandbox.enabled,
      run_dir: expandTilde((config.sandbox?.run_dir as string) ?? base.sandbox.run_dir),
      backend: (config.sandbox?.backend as any) ?? base.sandbox.backend,
      cache: (["shared", "project", "off"] as const).find((m) => m === config.sandbox?.cache) ?? base.sandbox.cache,
    },
    governance: {
      enabled: config.governance?.enabled ?? base.governance.enabled,
      mode: config.governance?.mode === "monitor" ? "monitor" : config.governance?.mode === "enforce" ? "enforce" : base.governance.mode,
      provider: (config.governance?.provider as any) ?? base.governance.provider,
      model_whitelist: (config.governance?.model_whitelist as string[]) ?? base.governance.model_whitelist,
      api_endpoint: (config.governance?.api_endpoint as string) ?? base.governance.api_endpoint,
      openai_api_key: (config.governance?.openai_api_key as string) ?? base.governance.openai_api_key,
      guardrails_endpoint: (config.governance?.guardrails_endpoint as string) ?? base.governance.guardrails_endpoint,
    },
    goodbehavior: {
      profile: (config.goodbehavior?.profile as string) ?? base.goodbehavior.profile,
    },
    threat_api: {
      enabled: config.threat_api?.enabled ?? base.threat_api.enabled,
      api_endpoint: (config.threat_api?.api_endpoint as string) ?? base.threat_api.api_endpoint,
    },
    feeds: {
      packages: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.packages) ?? base.feeds.packages,
      secrets: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.secrets) ?? base.feeds.secrets,
      commands: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.commands) ?? base.feeds.commands,
      urls: (["enforce", "monitor", "off"] as const).find((m) => m === config.feeds?.urls) ?? base.feeds.urls,
      allow: Array.isArray(config.feeds?.allow) ? (config.feeds.allow as unknown[]).filter((x): x is string => typeof x === "string") : base.feeds.allow,
      min_release_age: config.feeds?.min_release_age === undefined ? base.feeds.min_release_age : String(config.feeds.min_release_age),
      cache_ttl_hours: typeof config.feeds?.cache_ttl_hours === "number" ? config.feeds.cache_ttl_hours : base.feeds.cache_ttl_hours,
    },
  };
}

function validateTier(tier: unknown, fallback: 1 | 2 | 3 | 4 = DEFAULT_CONFIG.threat_detection.tier): 1 | 2 | 3 | 4 {
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4) {
    return tier;
  }
  return fallback;
}

import os from "os";
