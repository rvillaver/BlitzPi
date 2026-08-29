/**
 * GoodBehavior Integration for BlitzPi
 *
 * Bakes GoodBehavior framework into Pi agent
 * - Pre-installs skills (/audit-goodbehavior, /roadmap-goodbehavior, etc.)
 * - Tracks tool usage for behavioral verification
 * - Provides guidance on verification requirements
 */

import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

import { createDoneGate, DoneGate } from "./done-gate";
import { registerGoodBehaviorSkills } from "./skills";

export interface GoodBehaviorContext {
  doneGate: DoneGate;
  toolsCalled: string[];
}

let gbContext: GoodBehaviorContext | null = null;

export function setupGoodBehavior(pi: ExtensionAPI): void {
  console.log("[Blitz:GoodBehavior] Initializing...");

  try {
    // GoodBehavior skills ship with the BlitzPi package (package.json "pi.skills");
    // nothing is written into the user's project cwd.
    registerGoodBehaviorSkills(pi, "");

    // Initialize done-gate
    const doneGate = createDoneGate();
    gbContext = {
      doneGate,
      toolsCalled: [],
    };

    // Track tool calls for behavioral analysis
    pi.on("tool_call", (event: ToolCallEvent) => {
      if (gbContext) {
        const toolName = (event as any).toolName || (event as any).tool || "unknown";
        gbContext.toolsCalled.push(toolName);
      }
    });

    // Done-gate: when the agent settles, if the final assistant message claims completion without
    // any tool use this turn, surface a reminder (advisory — does not block the model).
    pi.on("agent_end", (event, ctx) => {
      if (!gbContext) return;
      const text = ((event as any).messages ?? [])
        .filter((m: any) => m.role === "assistant")
        .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text)
        .join("\n");
      const verdict = gbContext.doneGate.check(text, gbContext.toolsCalled);
      if (verdict.blocked && ctx.hasUI) {
        ctx.ui.notify(`GoodBehavior: ${verdict.reason ?? "completion claimed without verification this turn."}`, "warning");
      }
      gbContext.toolsCalled = [];
    });

    // GoodBehavior skills are NOT shipped into user workspaces (they hijacked context); done-gate only.
  } catch (error) {
    console.error("[Blitz:GoodBehavior] Setup failed:", error);
    throw error;
  }
}

export function getGoodBehaviorContext(): GoodBehaviorContext | null {
  return gbContext;
}
