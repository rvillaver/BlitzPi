/**
 * Blitz Pi — Governance Provider Tests
 * Tests for governance checkpoint: LLM call approval via configurable providers
 */

import { createGovernanceProvider } from "../src/governance-providers/factory";
import { CustomWebhookProvider } from "../src/governance-providers/custom-webhook";
import { GovernanceRequest } from "../src/governance-providers";

describe("Blitz Pi - Governance Providers", () => {
  describe("Provider Factory", () => {
    test("should create custom webhook provider by default", () => {
      const provider = createGovernanceProvider({ type: "custom" });
      expect(provider.name).toBe("custom");
    });

    test("should create OpenAI moderation provider", () => {
      const provider = createGovernanceProvider({
        type: "openai-moderation",
        openaiApiKey: "sk-test",
      });
      expect(provider.name).toBe("openai-moderation");
    });

    test("should create Guardrails provider", () => {
      const provider = createGovernanceProvider({
        type: "guardrails",
        guardrailsEndpoint: "http://localhost:8000",
      });
      expect(provider.name).toBe("guardrails");
    });
  });

  describe("Custom Webhook Provider", () => {
    test("should create provider with default endpoint", () => {
      const provider = new CustomWebhookProvider();
      expect(provider.name).toBe("custom");
    });

    test("should create provider with custom endpoint", () => {
      const provider = new CustomWebhookProvider("http://my-api.com/check");
      expect(provider.name).toBe("custom");
    });

    test("should use environment variable for endpoint", () => {
      process.env.BLITZ_GOVERNANCE_API = "http://env-api.com/check";
      const provider = new CustomWebhookProvider();
      expect(provider.name).toBe("custom");
      delete process.env.BLITZ_GOVERNANCE_API;
    });
  });

  describe("Provider Interface Compliance", () => {
    test("all providers should implement GovernanceProvider interface", async () => {
      const customProvider = createGovernanceProvider({ type: "custom" });

      expect(customProvider).toHaveProperty("name");
      expect(customProvider).toHaveProperty("check");
      expect(typeof customProvider.check).toBe("function");
    });

    test("check method should return GovernanceResponse", async () => {
      // Mock fetch to return a governance response
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: true,
          reason: "Test approved",
        }),
      } as any);

      const provider = new CustomWebhookProvider("http://test-api.local:9000");

      const request: GovernanceRequest = {
        run_id: "test-run-123",
        caller: { user: "testuser", install_type: "local", project_path: "/test" },
        model: "gpt-4",
        context: { messages_count: 1 },
      };

      const response = await provider.check(request);

      expect(response).toHaveProperty("approved");
      expect(response).toHaveProperty("reason");
      expect(typeof response.approved).toBe("boolean");
      expect(typeof response.reason).toBe("string");

      jest.restoreAllMocks();
    }, 10000);
  });
});
