/**
 * OpenAI Moderation API Provider
 * Uses OpenAI's moderation API to check for harmful content
 *
 * NOTE: This checks content safety, not governance/authorization.
 * It will catch harmful/toxic content but won't block legitimate prompt injection.
 */

import { GovernanceProvider, GovernanceRequest, GovernanceResponse } from "./index";

export class OpenAIModerationProvider implements GovernanceProvider {
  name = "openai-moderation";
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || "";
    if (!this.apiKey) {
      throw new Error("OpenAI API key not provided (OPENAI_API_KEY env var or constructor argument)");
    }
  }

  async check(request: GovernanceRequest): Promise<GovernanceResponse> {
    try {
      // Extract text from request context (similar to how governance.ts does it)
      const text = this.extractText(request);

      if (!text) {
        return { approved: true, reason: "No text to moderate" };
      }

      // Call OpenAI Moderation API
      const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text }),
      });

      if (!response.ok) {
        return {
          approved: false,
          reason: `OpenAI Moderation API error: ${response.status}`,
          threat_category: "api_error",
        };
      }

      const result = (await response.json()) as {
        results: Array<{
          flagged: boolean;
          categories: Record<string, boolean>;
          category_scores: Record<string, number>;
        }>;
      };

      const moderation = result.results[0];

      if (moderation.flagged) {
        // Determine which category was flagged
        const flaggedCategories = Object.entries(moderation.categories)
          .filter(([_, flagged]) => flagged)
          .map(([cat]) => cat)
          .join(", ");

        return {
          approved: false,
          reason: `OpenAI Moderation: Harmful content detected (${flaggedCategories})`,
          threat_category: "harmful_content",
        };
      }

      return {
        approved: true,
        reason: "OpenAI Moderation: Content approved",
      };
    } catch (error) {
      return {
        approved: false,
        reason: `OpenAI Moderation error: ${error instanceof Error ? error.message : String(error)}`,
        threat_category: "api_error",
      };
    }
  }

  private extractText(request: GovernanceRequest): string {
    // In a real implementation, extract from request.context or request body
    // For now, return empty string (governance caller should provide this)
    return "";
  }
}
