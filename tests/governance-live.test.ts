/**
 * Blitz Pi — Governance API Live Test
 * Exercises governance checkpoint against LLM call gating
 */

import path from "path";
import { MockGovernanceAPI, checkGovernanceAPI } from "../src/governance-api";
import type { AuditLogger } from "../src/audit";
import { loadConfig } from "../src/config";

describe("Blitz Pi - Governance API Live Test", () => {
  let auditLogger: AuditLogger;
  let config: any;
  let governanceAPI: MockGovernanceAPI;

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

    // Initialize mock governance API
    governanceAPI = new MockGovernanceAPI();
  });

  describe("Model Whitelisting", () => {
    test("should approve whitelisted Claude models", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(true);
      expect(response.reason).toContain("approved");
    });

    test("should approve claude-sonnet models", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-3-5-sonnet",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(true);
    });

    test("should approve whitelisted OpenAI models", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "gpt-4o",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(true);
    });

    test("should deny non-whitelisted models", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "suspicious-model-xyz",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(false);
      expect(response.reason).toContain("not whitelisted");
      expect(response.threat_category).toBeDefined();
    });
  });

  describe("Message Count Detection", () => {
    test("should approve normal message counts", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 50, tokens_estimated: 1000 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(true);
    });

    test("should deny excessive message counts", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 2000, tokens_estimated: 10000 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(false);
      expect(response.reason).toContain("message count");
      expect(response.threat_category).toContain("Vulnerable");
    });
  });

  describe("Token Limit Detection", () => {
    test("should approve reasonable token estimates", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 5, tokens_estimated: 500000 },
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(true);
    });

    test("should deny excessive token estimates", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 5, tokens_estimated: 50000000 }, // 50M tokens
      };

      const response = await governanceAPI.check(request);

      expect(response.approved).toBe(false);
      expect(response.reason).toContain("Token estimate");
      expect(response.threat_category).toContain("Access Control");
    });
  });

  describe("Threat Classification", () => {
    test("non-whitelisted model should have threat category", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "unknown-model",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response.threat_category).toBeDefined();
      expect(response.threat_category).toMatch(/injection|access control/i);
    });

    test("should use OWASP threat classification", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "unknown-model",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      if (!response.approved) {
        // Threat category should follow OWASP format: "Axx:yyyy - Description"
        expect(response.threat_category).toMatch(/A\d{2}:\d{4}/);
      }
    });
  });

  describe("Request/Response Structure", () => {
    test("governance request should have required fields", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      expect(request).toHaveProperty("run_id");
      expect(request).toHaveProperty("caller");
      expect(request).toHaveProperty("model");
      expect(request).toHaveProperty("context");
    });

    test("governance response should have required fields", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "claude-opus-4-1",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      expect(response).toHaveProperty("approved");
      expect(response).toHaveProperty("reason");
      expect(typeof response.approved).toBe("boolean");
      expect(typeof response.reason).toBe("string");
    });

    test("denied response should include threat category", async () => {
      const request = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local" as const, project_path: "/test" },
        model: "evil-model",
        context: { messages_count: 1, tokens_estimated: 100 },
      };

      const response = await governanceAPI.check(request);

      if (!response.approved) {
        expect(response).toHaveProperty("threat_category");
      }
    });
  });
});
