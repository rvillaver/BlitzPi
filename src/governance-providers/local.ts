/**
 * Local governance policy — no network. Enforces an optional model whitelist and always records the
 * decision. Prompt-injection is handled separately (scanned on the user prompt) so a running BlitzPi
 * needs no external server to deny; the webhook/openai/guardrails providers remain opt-in.
 */
import { GovernanceProvider, GovernanceRequest, GovernanceResponse } from "./index";

export class LocalGovernanceProvider implements GovernanceProvider {
  name = "local";
  constructor(private modelWhitelist: string[] = []) {}

  async check(request: GovernanceRequest): Promise<GovernanceResponse> {
    if (this.modelWhitelist.length > 0) {
      const base = request.model.split("/").pop() || request.model;
      const ok = this.modelWhitelist.some((m) => base.includes(m) || m.includes(base));
      if (!ok) {
        return { approved: false, reason: `Model "${request.model}" not in governance whitelist`, threat_category: "model_not_whitelisted" };
      }
    }
    return { approved: true, reason: "Local governance: allowed" };
  }
}
