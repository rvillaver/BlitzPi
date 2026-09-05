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
  private verifyHint?: string;
  // Defaults must name tools Pi actually registers: bash, edit, find, grep, ls, powershell, read, write (+ BlitzPi's
  // question, channel_post). A name outside that set never matches a real call, so it silently contributes nothing.
  // `read` is in the generic default because for non-software work reading the output/source IS the observation;
  // find/grep/ls are deliberately out — they are navigation and fire almost every turn, which would disarm the gate.
  constructor(buildTools: string[] = ["edit", "write", "bash"], observeTools: string[] = ["bash", "powershell", "read"], verifyHint?: string) {
    this.buildTools = new Set(buildTools.map((t) => t.toLowerCase()));
    this.observeTools = new Set(observeTools.map((t) => t.toLowerCase()));
    this.verifyHint = verifyHint?.trim() || undefined;
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
      // Profile-aware: name what THIS profile counts as observing, so a research session isn't told to "run the
      // code". `verify_hint` lets a profile phrase it in its own terms; otherwise fall back to its real tool names.
      const how = this.verifyHint ?? `use ${[...this.observeTools].join(" or ")} to observe the result`;
      return {
        blocked: true,
        reason: "Completion claimed without verification",
        feedback: `You claim completion but nothing this turn observed the result. Before saying 'done', ${how}.`,
      };
    }

    return { blocked: false };
  }
}

export function createDoneGate(buildTools?: string[], observeTools?: string[], verifyHint?: string): DoneGate {
  return new DoneGate(buildTools, observeTools, verifyHint);
}
