/**
 * Governance Provider Factory
 * Selects and instantiates the appropriate provider based on config
 */

import { GovernanceProvider } from "./index";
import { CustomWebhookProvider } from "./custom-webhook";
import { OpenAIModerationProvider } from "./openai-moderation";
import { GuardrailsProvider } from "./guardrails";
import { LocalGovernanceProvider } from "./local";

export type ProviderType = "local" | "custom" | "openai-moderation" | "guardrails";

export interface ProviderConfig {
  type: ProviderType;
  openaiApiKey?: string;
  guardrailsEndpoint?: string;
  customEndpoint?: string;
  modelWhitelist?: string[];
}

export function createGovernanceProvider(config: ProviderConfig): GovernanceProvider {
  switch (config.type) {
    case "local":
      return new LocalGovernanceProvider(config.modelWhitelist);

    case "openai-moderation":
      return new OpenAIModerationProvider(config.openaiApiKey);

    case "guardrails":
      return new GuardrailsProvider(config.guardrailsEndpoint);

    case "custom":
      return new CustomWebhookProvider(config.customEndpoint);

    default:
      return new LocalGovernanceProvider(config.modelWhitelist);
  }
}
