/**
 * Guardrails AI Provider
 * Calls a local/remote Guardrails AI server for governance decisions
 *
 * Setup: User runs Guardrails AI server (Python)
 * Default endpoint: http://localhost:8000/validate
 */

import { GovernanceProvider, GovernanceRequest, GovernanceResponse } from "./index";

export class GuardrailsProvider implements GovernanceProvider {
  name = "guardrails";
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || process.env.BLITZ_GUARDRAILS_ENDPOINT || "http://localhost:8000/validate";
  }

  async check(request: GovernanceRequest): Promise<GovernanceResponse> {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: request.run_id,
          model: request.model,
          caller: request.caller.user,
          // Guardrails expects the actual text/prompt to validate
          // This would come from the calling layer
        }),
      });

      if (!response.ok) {
        return {
          approved: false,
          reason: `Guardrails endpoint error: ${response.status}`,
          threat_category: "api_error",
        };
      }

      const result = (await response.json()) as {
        pass: boolean;
        reason?: string;
        failure_reason?: string;
      };

      return {
        approved: result.pass,
        reason: result.pass
          ? result.reason || "Guardrails: Validation passed"
          : result.failure_reason || "Guardrails: Validation failed",
        threat_category: result.pass ? undefined : "guardrails_violation",
      };
    } catch (error) {
      return {
        approved: false,
        reason: `Guardrails error: ${error instanceof Error ? error.message : String(error)}`,
        threat_category: "api_error",
      };
    }
  }
}
