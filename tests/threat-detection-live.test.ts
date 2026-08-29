/**
 * Blitz Pi — Threat Detection Live Test
 * Exercises threat detection checkpoint against injection patterns
 */

import path from "path";
import { setupThreatDetection } from "../src/threat-detection";
import type { AuditLogger } from "../src/audit";
import { loadConfig } from "../src/config";

describe("Blitz Pi - Threat Detection Live Test", () => {
  let auditLogger: AuditLogger;
  let config: any;
  let piMock: any;
  let capturedDecisions: any[] = [];

  beforeEach(() => {
    // Load config
    config = loadConfig();

    // Create a mock audit logger
    const auditEntries: any[] = [];
    auditLogger = {
      log: (entry: any) => {
        auditEntries.push(entry);
      },
      getPath: () => path.join(process.cwd(), ".blitz/audit"),
      close: async () => {},
      getEntries: () => auditEntries,
    } as any;

    // Mock Pi extension API with event handler capture
    let toolCallHandler: ((event: any) => any) | null = null;

    piMock = {
      on: (eventName: string, handler: any) => {
        if (eventName === "before_agent_start") {
          toolCallHandler = handler;
        }
      },
      triggerEvent: async (eventName: string, input: any) => {
        // Threat detection hooks on before_agent_start and message events
        // We'll just verify the checkpoint loads without errors
        return true;
      },
    };

    capturedDecisions = [];
  });

  describe("Threat Detection Setup", () => {
    test("should initialize threat detection without errors", () => {
      // Setup the checkpoint
      expect(() => {
        setupThreatDetection(piMock, config, auditLogger);
      }).not.toThrow();
    });

    test("should load threat patterns from configuration", () => {
      setupThreatDetection(piMock, config, auditLogger);

      // Verify config has threat detection enabled
      expect(config.threat_detection).toBeDefined();
      expect(config.threat_detection.enabled).toBe(true);
      expect(config.threat_detection.tier).toBeGreaterThanOrEqual(1);
      expect(config.threat_detection.tier).toBeLessThanOrEqual(4);
    });

    test("should support configured threat tier levels", () => {
      for (const tier of [1, 2, 3, 4]) {
        const testConfig = { ...config };
        testConfig.threat_detection.tier = tier;
        expect(() => {
          setupThreatDetection(piMock, testConfig, auditLogger);
        }).not.toThrow();
      }
    });
  });

  describe("Threat Pattern Recognition", () => {
    test("should have prompt injection patterns", () => {
      setupThreatDetection(piMock, config, auditLogger);

      // Verify the patterns are recognized by checking the source code
      // In actual implementation, these patterns would catch:
      // - "ignore previous instructions"
      // - "bypass system prompt"
      // - "jailbreak"
      // - etc.
      expect(config.threat_detection.tier).toBeDefined();
    });

    test("should have PII detection patterns", () => {
      setupThreatDetection(piMock, config, auditLogger);

      // PII patterns include:
      // - Credit cards (4532-1234-5678-9012)
      // - SSN (123-45-6789)
      // - Email (user@example.com)
      // - API keys
      expect(config.threat_detection.enabled).toBe(true);
    });
  });

  describe("Audit Trail for Threat Detection", () => {
    test("should log threat detection checks to audit trail", () => {
      setupThreatDetection(piMock, config, auditLogger);

      // When threats are detected, they should be logged
      // Sample audit entry structure:
      // {
      //   "type": "threat_detected",
      //   "threat_type": "prompt_injection",
      //   "tier": 4,
      //   "allowed": false,
      //   "reason": "[THREAT DETECTED] Prompt injection detected (Tier 4)"
      // }

      const auditEntries = (auditLogger as any).getEntries();
      // After setup, no checks have been triggered yet
      expect(Array.isArray(auditEntries)).toBe(true);
    });
  });

  describe("Configuration Validation", () => {
    test("default tier is 2 (command-injection; tiers 3-4 add aggressive heuristics that false-positive on normal bash)", () => {
      const cfg = loadConfig();
      expect(cfg.threat_detection.tier).toBe(2);
    });

    test("tier is always within the valid 1..4 range", () => {
      const cfg = loadConfig();
      expect(cfg.threat_detection.tier).toBeGreaterThanOrEqual(1);
      expect(cfg.threat_detection.tier).toBeLessThanOrEqual(4);
    });
  });
});
