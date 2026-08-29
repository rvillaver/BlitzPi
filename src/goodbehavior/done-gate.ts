/**
 * GoodBehavior Done-Gate for Pi
 *
 * Blocks unverified "done" claims. When the assistant message claims completion
 * without supporting evidence, it feeds back a self-check.
 *
 * Two layers:
 *   LEXICAL — what the message says
 *   BEHAVIORAL — what actually happened (tools run, observations made)
 */

interface DoneGateResult {
  blocked: boolean;
  reason?: string;
  feedback?: string;
}

export class DoneGate {
  private buildTools: Set<string>;
  private observeTools: Set<string>;
  constructor(buildTools: string[] = ["edit", "write", "bash"], observeTools: string[] = ["bash", "webfetch"]) {
    this.buildTools = new Set(buildTools.map((t) => t.toLowerCase()));
    this.observeTools = new Set(observeTools.map((t) => t.toLowerCase()));
  }
  private docExtensions = new Set([".md", ".markdown", ".txt", ".rst", ".adoc"]);

  private claimPattern = /✅|\bit'?s (now )?(done|complete|working)\b|\b(all )?(done|complete|completed|finished|shipped)\b/i;
  private hedgePattern = /not (yet|done)|unverified|uncertain|preliminary/i;

  check(message: string, toolsCalled: string[]): DoneGateResult {
    // (1) No claim = no gate
    if (!this.claimPattern.test(message)) {
      return { blocked: false };
    }

    // (0a) Hedge present = let through (honest downgrade)
    if (this.hedgePattern.test(message)) {
      return { blocked: false };
    }

    // (3) Activity gate: only arm if build tools were used
    const hadBuildActivity = toolsCalled.some((tool) => this.buildTools.has(tool.toLowerCase()));
    if (!hadBuildActivity) {
      return { blocked: false }; // Pure discussion, no code touched
    }

    // (0b) Check if observation happened after changes
    const hadObservation = toolsCalled.some((tool) => this.observeTools.has(tool.toLowerCase()));

    if (!hadObservation) {
      return {
        blocked: true,
        reason: "Completion claimed without verification",
        feedback:
          "You claim completion but didn't run the code or test it. " +
          "Before saying 'done', verify the change works (bash, webfetch, or similar observation).",
      };
    }

    return { blocked: false };
  }
}

export function createDoneGate(buildTools?: string[], observeTools?: string[]): DoneGate {
  return new DoneGate(buildTools, observeTools);
}
