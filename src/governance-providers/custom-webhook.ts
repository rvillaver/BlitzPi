/**
 * Custom Webhook Provider
 * Calls a user-provided HTTP endpoint for governance decisions
 * Most flexible option — user controls the logic entirely
 */

import { GovernanceProvider, GovernanceRequest, GovernanceResponse } from "./index";

export class CustomWebhookProvider implements GovernanceProvider {
  name = "custom";
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.BLITZ_GOVERNANCE_API || "http://localhost:9000/governance/check";
  }

  async check(request: GovernanceRequest): Promise<GovernanceResponse> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        return {
          approved: false,
          reason: `Custom governance API error: ${response.status}`,
          threat_category: "api_error",
        };
      }

      const result = (await response.json()) as GovernanceResponse;
      return result;
    } catch (error) {
      return {
        approved: false,
        reason: `Custom governance API error: ${error instanceof Error ? error.message : String(error)}`,
        threat_category: "api_error",
      };
    }
  }
}
