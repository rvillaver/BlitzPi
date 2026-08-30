import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { stats } from "./security-status";
import { BlitzConfig } from "./config";
import { AuditLogger } from "./audit";
import { debug } from "./log";

/**
 * Threat detection patterns for Tier 1 (fast, pattern-based detection)
 */
/** Named so a content-scan hit can say WHICH shape matched without echoing the content. */
export const INJECTION_SHAPES: { name: string; re: RegExp }[] = [
  { name: "ignore-instructions", re: /ignore\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|above\s+|earlier\s+)?(?:instructions?|rules|guidelines|prompts?)/i },
  { name: "disregard-instructions", re: /disregard\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|above\s+)?(?:instructions?|rules|guidelines)/i },
  { name: "override-system-prompt", re: /(?:override|bypass|forget|reveal|print|repeat)\s+(?:the\s+|your\s+)?(?:system\s+)?prompt/i },
  { name: "new-instructions", re: /\bnew\s+instructions?\s*:/i },
  { name: "you-are-now", re: /\b(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|pretend\s+(?:that\s+)?you\s+are)\b/i },
  { name: "role-switch", re: /\bact\s+as\s+(?:a\s+|an\s+)?(?:system|admin|root|developer\s+mode|dan)\b/i },
  { name: "jailbreak", re: /\bjailbreak(?:ed|ing)?\b|\bDAN\s+mode\b/i },
  { name: "to-the-ai", re: /\b(?:attention|note|important(?:\s+note)?|message)\s*(?:to|for)?\s*(?:the\s+|any\s+)?(?:ai|assistant|llm|language\s+model|agent|claude|gpt|copilot)(?:\s+(?:assistants?|models?|agents?|systems?))?\s*[:!]/i },
  { name: "hidden-instruction-marker", re: /<\s*(?:system|instructions?|assistant)\s*>|\[(?:SYSTEM|INST|INSTRUCTIONS?)\]|BEGIN\s+(?:SYSTEM|HIDDEN)\s+(?:PROMPT|INSTRUCTIONS?)/i },
  { name: "run-command-instruction", re: /\b(?:run|execute)\s+(?:this|the\s+following)\s+(?:shell\s+)?command\s*:/i },
  { name: "exfiltrate", re: /\b(?:send|post|upload|exfiltrate)\s+(?:the\s+|all\s+|your\s+)?(?:contents?|files?|secrets?|keys?|credentials?|env(?:ironment)?)\s+(?:of\s+\S+\s+)?to\s+https?:\/\//i },
  { name: "delete-everything", re: /\b(?:delete|remove|wipe)\s+(?:all\s+)?(?:the\s+)?(?:files|repository|repo|everything)\b/i },
];

const THREAT_PATTERNS = {
  prompt_injection: [
    /ignore\s+(?:previous\s+)?instructions?/i,
    /bypass\s+(?:the\s+)?(?:system\s+)?prompt/i,
    /disregard\s+(?:previous\s+)?instructions?/i,
    /override\s+(?:the\s+)?system\s+prompt/i,
    /role\s+play(?:ing)?\s+as/i,
    /act\s+as\s+(?:a\s+)?(?:system|admin|root)/i,
    /forget\s+(?:the\s+)?system\s+prompt/i,
    /new\s+instructions?:/i,
    /instead,\s+(?:you\s+)?should/i,
    /jailbreak/i,
    /as\s+an\s+(?:AI|assistant|LLM),\s+you\s+are\s+now/i,
    /pretend\s+you\s+are\s+not\s+an\s+AI/i,
    /delete\s+(?:all\s+)?files/i,
    /format\s+(?:the\s+)?(?:hard\s+)?drive/i,
    /execute\s+(?:shell|system|system\s+shell)\s+command/i,
    /run\s+(?:this\s+)?command:/i,
  ],
  pii_patterns: {
    email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/,
    ssn: /\b(?:\d{3}-\d{2}-\d{4}|\d{9})\b/,
    credit_card: /\b(?:\d{4}[- ]?){3}\d{4}\b/,
    phone: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/,
    api_key: /(?:api[_-]?key|apikey|api_secret|secret[_-]?key|auth[_-]?token|token)\s*[:=]\s*[a-zA-Z0-9_-]{20,}/i,
  },
};

/**
 * What the detectors look at. Tool inputs carry two very different things: the agent's INSTRUCTIONS to the
 * tool (a shell command, a path, a URL) and the agent's OUTPUT (file content, edit text). Injection / traversal
 * heuristics only make sense on the former — scanning file content blocked every write containing `??`, an
 * email address or a 9-digit number. Content is governed by zones + sandbox, not by regexes.
 */
const COMMAND_FIELDS = ["command", "cmd", "script", "args"];
const PATH_FIELDS = ["path", "file", "filePath", "file_path", "paths", "oldPath", "newPath", "directory", "dir", "cwd", "pattern"];
const URL_FIELDS = ["url", "urls", "uri", "href", "endpoint"];
function pick(input: Record<string, unknown>, fields: string[]): string {
  const out: string[] = [];
  for (const f of fields) {
    const v = input[f];
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x);
  }
  return out.join("\n");
}
export function scannableText(input: Record<string, unknown>): { command: string; paths: string; urls: string; all: string } {
  const command = pick(input, COMMAND_FIELDS);
  const paths = pick(input, PATH_FIELDS);
  const urls = pick(input, URL_FIELDS);
  return { command, paths, urls, all: [command, paths, urls].filter(Boolean).join("\n") };
}

/**
 * Tier 1 threat detector (fast pattern matching)
 */
class Tier1Detector {
  detect(input: Record<string, unknown>): {
    blocked: boolean;
    reason?: string;
    threatType?: string;
    threatContent?: string;
    piiObserved?: string;
  } {
    const scoped = scannableText(input);
    const text = scoped.all.toLowerCase();

    // Check prompt injection patterns
    for (const pattern of THREAT_PATTERNS.prompt_injection) {
      if (pattern.test(text)) {
        return {
          blocked: true,
          reason: "Prompt injection detected",
          threatType: "prompt_injection",
          threatContent: text.substring(0, 100),
        };
      }
    }

    // PII in a command/URL is observed (audited), never blocked: the agent's own tool input is not exfiltration.
    for (const [piiType, pattern] of Object.entries(THREAT_PATTERNS.pii_patterns)) {
      if (pattern.test(scoped.all)) return { blocked: false, piiObserved: piiType };
    }

    return { blocked: false };
  }
}

/**
 * Tier 2 detector (enhanced with additional patterns and heuristics)
 */
class Tier2Detector extends Tier1Detector {
  detect(input: Record<string, unknown>): ReturnType<Tier1Detector["detect"]> {
    // First run Tier 1 detection
    const tier1Result = super.detect(input);
    if (tier1Result.blocked) {
      return tier1Result;
    }

    // Additional Tier 2 heuristics — command fields for injection, path fields for traversal
    const scoped = scannableText(input);
    const text = scoped.all;

    // Check for suspicious shell metacharacters in command-like fields
    if (this.hasCommandInjectionHints(scoped.command)) {
      return {
        blocked: true,
        reason: "Command injection pattern detected",
        threatType: "command_injection",
        threatContent: text.substring(0, 100),
      };
    }

    // Check for path traversal attempts (path fields only; zones resolve real escapes, this catches encoded ones)
    if (this.hasPathTraversalHints(scoped.paths)) {
      return {
        blocked: true,
        reason: "Path traversal pattern detected",
        threatType: "path_traversal",
        threatContent: text.substring(0, 100),
      };
    }

    return tier1Result; // not blocked; carries piiObserved
  }

  private hasCommandInjectionHints(text: string): boolean {
    // NOTE: bash/powershell are governed by the bash guard (allow/confirm/deny) + the OS sandbox, which
    // understand shell properly. This heuristic must NOT flag normal shell (`$(...)`, backticks,
    // `2>/dev/null`, `&&`) — only genuinely malicious remote-exec/reverse-shell shapes.
    const patterns = [
      /\b(?:curl|wget|fetch)\b[^\n|;&)]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|powershell)\b/i, // download|shell (same statement only)
      /\|\s*nc\s+-?[a-z]*e/i,      // netcat reverse shell (nc -e)
      /\/dev\/tcp\//i,             // bash /dev/tcp reverse shell
    ];
    return patterns.some((p) => p.test(text));
  }

  private hasPathTraversalHints(paths: string): boolean {
    // `../` inside a project is normal; flag URL-encoded traversal and deep escapes (3+ segments) only.
    const encoded = /%2e%2e/i.test(paths) || /\.\.%2f/i.test(paths);
    const deep = (paths.match(/\.\.[\/\\]/g) || []).length > 2;
    return encoded || deep;
  }
}

/**
 * Tier 3 detector (semantic analysis with context awareness)
 */
class Tier3Detector extends Tier2Detector {
  detect(input: Record<string, unknown>): ReturnType<Tier1Detector["detect"]> {
    // First run Tier 2 detection
    const tier2Result = super.detect(input);
    if (tier2Result.blocked) {
      return tier2Result;
    }

    const text = scannableText(input).all;

    // Analyze context for suspicious combinations
    if (this.hasSuspiciousCombinations(text, input)) {
      return {
        blocked: true,
        reason: "Suspicious combination of indicators detected",
        threatType: "context_anomaly",
        threatContent: text.substring(0, 100),
      };
    }

    return tier2Result;
  }

  private hasSuspiciousCombinations(
    text: string,
    input: Record<string, unknown>
  ): boolean {
    // Check for combinations like: command field + redirection + sensitive path
    const hasSuspiciousCommand =
      /(?:execute|run|command|bash|shell)/i.test(text) &&
      /(?:>|>>|\||&|;)/i.test(text);

    // Check for unusual encoding patterns
    const hasHighEncoding =
      (text.match(/%[0-9a-f]{2}/gi) || []).length > 3 ||
      (text.match(/&#\d+;/g) || []).length > 2;

    // Check for suspicious field combinations
    const hasSuspiciousCombos =
      (typeof input.command === "string" &&
        input.command.includes("../")) ||
      (typeof input.path === "string" &&
        input.path.includes("..") &&
        typeof input.file === "string");

    return hasSuspiciousCommand || hasHighEncoding || hasSuspiciousCombos;
  }
}

/**
 * Tier 4 detector (most aggressive - combines all checks with strict thresholds)
 */
class Tier4Detector extends Tier3Detector {
  detect(input: Record<string, unknown>): ReturnType<Tier1Detector["detect"]> {
    // Run Tier 3 detection first
    const tier3Result = super.detect(input);
    if (tier3Result.blocked) {
      return tier3Result;
    }

    const text = JSON.stringify(input);

    // Tier 4: Ultra-strict analysis
    if (this.hasAggressiveThreats(text)) {
      return {
        blocked: true,
        reason: "Aggressive threat indicators detected",
        threatType: "aggressive_threat",
        threatContent: text.substring(0, 100),
      };
    }

    return tier3Result;
  }

  private hasAggressiveThreats(text: string): boolean {
    // Check for any suspicious keywords or patterns with lower thresholds
    const suspiciousKeywords = [
      "malicious",
      "exploit",
      "vulnerability",
      "penetration",
      "backdoor",
      "rootkit",
      "trojan",
      "payload",
      "shellcode",
    ];

    const suspiciousCount = suspiciousKeywords.filter((keyword) =>
      text.toLowerCase().includes(keyword)
    ).length;

    if (suspiciousCount > 0) {
      return true;
    }

    // Check for obfuscation indicators
    const obfuscationIndicators = [
      /\\[a-f0-9]/i,
      /0x[0-9a-f]+/gi,
      /chr\(\d+\)/i,
      /fromCharCode/i,
    ];

    return obfuscationIndicators.some((pattern) => pattern.test(text));
  }
}

/**
 * Get the appropriate detector based on threat tier
 */
function getDetectorForTier(tier: 1 | 2 | 3 | 4): Tier1Detector {
  switch (tier) {
    case 1:
      return new Tier1Detector();
    case 2:
      return new Tier2Detector();
    case 3:
      return new Tier3Detector();
    case 4:
      return new Tier4Detector();
  }
}


export function setupThreatDetection(
  pi: ExtensionAPI,
  config: BlitzConfig,
  auditLogger: AuditLogger
): void {
  console.log(
    `[Blitz:ThreatDetection] Setup (tier ${config.threat_detection.tier})`
  );

  if (!config.threat_detection.enabled) {
    console.log("[Blitz:ThreatDetection] Disabled by configuration");
    return;
  }

  const detector = getDetectorForTier(config.threat_detection.tier);

  // Register the tool_call event handler
  pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | void> => {
    try {
      // Check for threats in the tool input (commands / paths / URLs — never file content)
      const detection = detector.detect(event.input);
      if (detection.piiObserved) {
        auditLogger.log({ type: "threat_detection_check", allowed: true, action: "pii_observed", tier: config.threat_detection.tier, tool_name: event.toolName, tool_call_id: event.toolCallId, pii_type: detection.piiObserved });
      }

      if (detection.blocked) {
        // Log the threat detection
        auditLogger.log({
          type: "threat_detection_check",
          allowed: false,
          tier: config.threat_detection.tier,
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
          threat_type: detection.threatType,
          reason: detection.reason,
          content_sample: detection.threatContent,
          input_snapshot: JSON.stringify(event.input).substring(0, 200),
        });

        debug(`ThreatDetection BLOCKED ${detection.threatType} in ${event.toolName} call`);

        // Block the tool execution
        stats.blocked.threat++;
        return {
          block: true,
          reason: `[THREAT DETECTED] ${detection.reason} (Tier ${config.threat_detection.tier})`,
        };
      }

      // Log allowed calls at higher tiers for audit trail
      if (config.threat_detection.tier >= 3) {
        auditLogger.log({
          type: "threat_detection_check",
          allowed: true,
          tier: config.threat_detection.tier,
          tool_name: event.toolName,
          tool_call_id: event.toolCallId,
        });
      }
    } catch (error) {
      // Log errors but don't block on detection failures
      debug("ThreatDetection error:", error instanceof Error ? error.message : String(error));
      auditLogger.log({
        type: "threat_detection_check",
        allowed: false,
        event: "threat_detection_error",
        error: error instanceof Error ? error.message : String(error),
        tool_name: event.toolName,
        tool_call_id: event.toolCallId,
      });
    }
  });

  console.log("[Blitz:ThreatDetection] Listening for tool calls...");
}
