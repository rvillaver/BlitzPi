/**
 * R5.4: Governance Provider Abstraction
 * Pluggable providers for LLM call approval decisions
 */

export interface GovernanceRequest {
  run_id: string;
  caller: {
    user: string;
    install_type: "global" | "local";
    project_path: string;
  };
  model: string;
  context?: {
    messages_count?: number;
    tokens_estimated?: number;
  };
}

export interface GovernanceResponse {
  approved: boolean;
  reason: string;
  threat_category?: string;
}

export interface GovernanceProvider {
  name: string;
  check(request: GovernanceRequest): Promise<GovernanceResponse>;
}
