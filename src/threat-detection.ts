import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { BlitzConfig } from "./config";
import { AuditLogger } from "./audit";
import { debug } from "./log";

/**
 * Threat detection patterns for Tier 1 (fast, pattern-based detection)
 */
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
 * Tier 1 threat detector (fast pattern matching)
 */
class Tier1Detector {
  detect(input: Record<string, unknown>): {
    blocked: boolean;
    reason?: string;
    threatType?: string;
    threatContent?: string;
  } {
    const text = JSON.stringify(input).toLowerCase();

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

    // Check for PII patterns
    for (const [piiType, pattern] of Object.entries(THREAT_PATTERNS.pii_patterns)) {
      if (pattern.test(JSON.stringify(input))) {
        return {
          blocked: true,
          reason: `PII detected: ${piiType}`,
          threatType: "pii",
          threatContent: piiType,
        };
      }
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

    // Additional Tier 2 heuristics
    const text = JSON.stringify(input);

    // Check for suspicious shell metacharacters in command-like fields
    if (this.hasCommandInjectionHints(text)) {
      return {
        blocked: true,
        reason: "Command injection pattern detected",
        threatType: "command_injection",
        threatContent: text.substring(0, 100),
      };
    }

    // Check for path traversal attempts
    if (this.hasPathTraversalHints(text)) {
      return {
        blocked: true,
        reason: "Path traversal pattern detected",
        threatType: "path_traversal",
        threatContent: text.substring(0, 100),
      };
    }

    return { blocked: false };
  }

  private hasCommandInjectionHints(text: string): boolean {
    // NOTE: bash/powershell are governed by the bash guard (allow/confirm/deny) + the OS sandbox, which
    // understand shell properly. This heuristic must NOT flag normal shell (`$(...)`, backticks,
    // `2>/dev/null`, `&&`) — only genuinely malicious remote-exec/reverse-shell shapes.
    const patterns = [
      /\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|powershell)\b/i, // download|shell
      /\|\s*nc\s+-?[a-z]*e/i,      // netcat reverse shell (nc -e)
      /\/dev\/tcp\//i,             // bash /dev/tcp reverse shell
    ];
    return patterns.some((p) => p.test(text));
  }

  private hasPathTraversalHints(text: string): boolean {
    const patterns = [/\.\.\//g, /\.\.\\/, /\?/, /%2e%2e/i];
    const count = (text.match(/\.\.\//g) || []).length;
    return patterns.some((p) => p.test(text)) || count > 2;
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

    const text = JSON.stringify(input);

    // Analyze context for suspicious combinations
    if (this.hasSuspiciousCombinations(text, input)) {
      return {
        blocked: true,
        reason: "Suspicious combination of indicators detected",
        threatType: "context_anomaly",
        threatContent: text.substring(0, 100),
      };
    }

    return { blocked: false };
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

    return { blocked: false };
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

/**
 * Sanitize tool input by removing or redacting PII
 */
function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized = JSON.parse(JSON.stringify(input));

  // Redact email addresses
  const emailPattern = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  if (typeof sanitized.command === "string") {
    sanitized.command = sanitized.command.replace(emailPattern, "[REDACTED_EMAIL]");
  }
  if (typeof sanitized.text === "string") {
    sanitized.text = sanitized.text.replace(emailPattern, "[REDACTED_EMAIL]");
  }

  // Redact API keys
  const apiKeyPattern =
    /(?:api[_-]?key|apikey|api_secret|secret[_-]?key|auth[_-]?token|token)\s*[:=]\s*[a-zA-Z0-9_-]{20,}/gi;
  const stringifiedInput = JSON.stringify(sanitized);
  if (apiKeyPattern.test(stringifiedInput)) {
    // For now, we'll log this but not modify since it's complex
    return sanitized;
  }

  return sanitized;
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
      // Check for threats in the tool input
      const detection = detector.detect(event.input);

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
        return {
          block: true,
          reason: `[THREAT DETECTED] ${detection.reason} (Tier ${config.threat_detection.tier})`,
        };
      }

      // Optionally sanitize input for lower tiers (in higher tiers, we might want stricter blocking)
      if (config.threat_detection.tier <= 2) {
        const sanitized = sanitizeInput(event.input);
        // Mutate the input in place if sanitization changed anything
        if (JSON.stringify(sanitized) !== JSON.stringify(event.input)) {
          Object.assign(event.input, sanitized);
          auditLogger.log({
            type: "threat_detection_check",
            allowed: true,
            action: "sanitized_input",
            tier: config.threat_detection.tier,
            tool_name: event.toolName,
            tool_call_id: event.toolCallId,
          });
        }
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
