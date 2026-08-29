/**
 * Governance API contract types and mock implementation
 */

export interface GovernanceRequest {
  run_id: string;
  caller: {
    user: string;
    install_type: "global" | "local";
    project_path: string;
  };
  model: string;
  context: {
    messages_count: number;
    tokens_estimated: number;
  };
}

export interface GovernanceResponse {
  approved: boolean;
  reason: string;
  threat_category?: string;
}

/**
 * Mock governance API for testing.
 * - Allows common models (claude-opus, gpt-4, claude-sonnet, gpt-3.5-turbo)
 * - Denies unusual patterns (models not in whitelist)
 * - Returns OWASP threat classification if denied
 */
export class MockGovernanceAPI {
  private allowedModels = new Set([
    "claude-opus-4-1",
    "claude-opus-4-0",
    "claude-opus",
    "claude-3-5-sonnet",
    "claude-3-sonnet",
    "claude-sonnet",
    "gpt-4",
    "gpt-4o",
    "gpt-3.5-turbo",
  ]);

  async check(request: GovernanceRequest): Promise<GovernanceResponse> {
    // Check if model is in whitelist
    const modelBase = request.model.split("/").pop() || request.model;
    const isAllowed = Array.from(this.allowedModels).some((allowed) =>
      modelBase.includes(allowed) || allowed.includes(modelBase)
    );

    if (!isAllowed) {
      return {
        approved: false,
        reason: `Model "${request.model}" is not whitelisted for governance`,
        threat_category: "A03:2021 - Injection",
      };
    }

    // Check for unusual message counts (potential loop detection)
    if (request.context.messages_count > 1000) {
      return {
        approved: false,
        reason: "Excessive message count detected - possible infinite loop",
        threat_category: "A06:2021 - Vulnerable and Outdated Components",
      };
    }

    // Check for suspicious token estimates
    if (request.context.tokens_estimated > 10000000) {
      return {
        approved: false,
        reason: "Token estimate exceeds safety threshold",
        threat_category: "A01:2021 - Broken Access Control",
      };
    }

    // Approved by default for whitelisted models
    return {
      approved: true,
      reason: `Model "${request.model}" approved for execution by caller ${request.caller.user}`,
    };
  }
}

/**
 * Real governance API client - sends requests to remote endpoint
 */
export async function checkGovernanceAPI(
  endpoint: string,
  request: GovernanceRequest
): Promise<GovernanceResponse> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Governance API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GovernanceResponse;
  } catch (error) {
    // If governance API is unavailable, deny by default (fail secure)
    console.error("[Blitz:Governance] API check failed:", error);
    return {
      approved: false,
      reason: `Governance API unavailable: ${error instanceof Error ? error.message : String(error)}`,
      threat_category: "Infrastructure Error",
    };
  }
}
