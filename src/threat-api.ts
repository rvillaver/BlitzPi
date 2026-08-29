/**
 * Threat detection API client
 * Sends suspicious prompts to external threat intelligence service
 * for ML-based analysis beyond pattern matching
 */

export interface ThreatCheckRequest {
  text: string;
  model: string;
  caller_user: string;
}

export interface ThreatCheckResponse {
  is_threat: boolean;
  threat_type?: string;
  confidence?: number;
  reason?: string;
}

export async function checkThreatAPI(endpoint: string, request: ThreatCheckRequest): Promise<ThreatCheckResponse> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        is_threat: false,
        reason: `Threat API error: ${response.status}`,
      };
    }

    return (await response.json()) as ThreatCheckResponse;
  } catch (error) {
    console.error("[Blitz:ThreatAPI] Request failed:", error instanceof Error ? error.message : String(error));
    return {
      is_threat: false,
      reason: `Threat API unavailable: ${error instanceof Error ? error.message : "unknown"}`,
    };
  }
}

/**
 * Mock threat API for testing (returns random threat decisions)
 */
export class MockThreatAPI {
  async check(request: ThreatCheckRequest): Promise<ThreatCheckResponse> {
    // For testing: if text contains "definitely_malicious", flag it
    if (request.text.toLowerCase().includes("definitely_malicious")) {
      return {
        is_threat: true,
        threat_type: "prompt_injection_ml",
        confidence: 0.95,
        reason: "ML model detected prompt injection pattern with high confidence",
      };
    }

    // Otherwise approve
    return {
      is_threat: false,
      confidence: 0.98,
      reason: "ML model approved text",
    };
  }
}
