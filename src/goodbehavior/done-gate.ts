/**
 * GoodBehavior Done-Gate for Pi — pushes back on self-declared "done".
 *
 * A port of GoodBehavior's own done-gate, and it keeps that gate's principles: a heuristic nudge, not a lie detector.
 * It never judges whether the evidence is GOOD — the profile defines what real evidence is, the agent has to show it,
 * and the user confirming it is what makes work done. What the gate catches is the cheap failure: a claim with nothing
 * behind it. It is language-agnostic on purpose — it reads tool names and their order, never command contents.
 *
 * Two layers:
 *   LEXICAL    — what the message says. An honest hedge ("not done yet", "unverified") always lets it through.
 *                Verification vocabulary ("verified", "I ran", "tests pass") is only a *claim* of proof.
 *   BEHAVIORAL — what the turn actually did. Verification vocabulary is honored only if something was observed AFTER
 *                the last file change. "Edited files, ran nothing, said 'verified'" is a hollow proof.
 *
 * Three tool roles, from the profile's `done_gate` front-matter:
 *   build_tools   — using one means the turn did real work; arms the gate.
 *   mutate_tools  — tools that change files; the behavioral check asks what came after the last of these.
 *   observe_tools — running/reading/fetching the real thing.
 * `bash` belongs in build_tools AND observe_tools: it is how development work both builds and checks. That is safe
 * because the ordering is keyed on mutate_tools, not build_tools. A file written from a shell command
 * (`cat > f <<EOF`) is not seen as a change — the accepted blind spot of reading tool names, not command text.
 *
 * False-positive controls, in the order they short-circuit:
 *   (3) Activity gate  — only arm when this turn used a build tool. Pure discussion never trips it.
 *   (1) Meta escape    — talking ABOUT the gate/framework isn't a claim.
 *   (2) Assertive only — the completion word must head a short declarative clause.
 *   (0a) Hedge         — an honest downgrade always passes.
 *   (0b) Proof+observed — verification vocabulary + an observation after the last change passes. Doc-only turns (every
 *        change touched .md/.txt/…) skip the behavioral check: there is often nothing to run for prose.
 */

export interface ToolCall { name: string; input?: Record<string, unknown> }

export interface DoneGateResult {
  blocked: boolean;
  reason?: string;
  feedback?: string;
}

const DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".rst", ".adoc"];

const CLAIM = /(✅|\bit'?s (now )?(done|complete|working)\b|\b(all )?(done|complete|completed|finished|shipped)\b|\bworks now\b|\bfully (working|functional)\b|\bgood to go\b|\ball set\b)/;
const HEDGE = /(not (yet|done)|isn't done|unverified|partial|in progress|pending|blocked|deferred|backlog|to verify|still to|left to do|remaining|please (check|review|confirm)|you (can )?(check|confirm))/;
const PROOF = /(verif|screenshot|i ran|ran the|test(s)? pass|passing|confirm|evidence|rendered|observed)/;
const META = /(done-gate|good ?behavior|the (gate|hook)|this hook|the regex|false (positive|trigger))/;

export class DoneGate {
  private buildTools: Set<string>;
  private observeTools: Set<string>;
  private mutateTools: Set<string>;
  private verifyHint?: string;

  // Defaults must name tools Pi actually registers: bash, edit, find, grep, ls, powershell, read, write (+ BlitzPi's
  // question, channel_post). A name outside that set never matches a real call, so it silently contributes nothing.
  // `read` is in the generic default because for non-software work reading the output/source IS the observation;
  // find/grep/ls are deliberately out — they are navigation and fire almost every turn, which would disarm the gate.
  constructor(
    buildTools: string[] = ["edit", "write", "bash"],
    observeTools: string[] = ["bash", "powershell", "read"],
    verifyHint?: string,
    mutateTools: string[] = ["edit", "write"],
  ) {
    const set = (xs: string[]) => new Set(xs.map((t) => t.toLowerCase()));
    this.buildTools = set(buildTools);
    this.mutateTools = set(mutateTools);
    // A tool that changes files cannot also be the observation of that change (fail closed on a mis-drafted profile).
    this.observeTools = new Set([...set(observeTools)].filter((t) => !this.mutateTools.has(t)));
    this.verifyHint = verifyHint?.trim() || undefined;
  }

  check(message: string, toolsCalled: ToolCall[]): DoneGateResult {
    const text = message.trim();
    if (!text) return { blocked: false };
    const t = text.toLowerCase();
    const tools = toolsCalled.map((c) => ({ name: c.name.toLowerCase(), input: c.input ?? {} }));

    // (3) Activity gate: a turn that didn't build anything can't have "finished" anything.
    if (!tools.some((c) => this.buildTools.has(c.name))) return { blocked: false };
    // (1) Meta escape: discussing the gate/framework uses words like "done" incidentally.
    if (META.test(t)) return { blocked: false };
    // (2) Assertive only: the claim must head a short clause, not lurk in a long sentence.
    if (!assertiveClaim(text)) return { blocked: false };
    // (0a) An honest hedge always passes — never punish the downgrade.
    if (HEDGE.test(t)) return { blocked: false };

    const how = this.verifyHint ?? `use ${[...this.observeTools].join(" or ")} to observe the result`;
    // (0b) Verification vocabulary passes only when the behavior backs it.
    if (PROOF.test(t)) {
      if (this.docOnlyMutations(tools) || this.observedAfterLastMutation(tools)) return { blocked: false };
      return {
        blocked: true,
        reason: "Verification claimed, but nothing was observed after the last change",
        feedback:
          "GoodBehavior done-gate — you claim verification, but this turn ran/observed NOTHING after its last file change: " +
          `the final state of the work was never exercised. Either actually observe the real thing now (${how}) and show ` +
          'the result, or downgrade the claim to "unverified / not done yet" and say what\'s left. A proof-word without ' +
          "an observation is the exact failure this method exists to stop.",
      };
    }

    return {
      blocked: true,
      reason: "Completion claimed without evidence",
      feedback:
        "GoodBehavior done-gate — you claimed completion. Before ending, self-check:\n" +
        `  1) Did you exercise the REAL thing the way its consumer would (${how}) — not just a test or your description?\n` +
        "  2) Can you SHOW the evidence (the flow firing / the output / the source-backed claim)?\n" +
        '  3) Is it user-confirmed? If not, say "not done yet" / state what\'s left — don\'t self-declare done.\n' +
        "Then either present the evidence, soften the claim, or record a learning and continue.",
    };
  }

  /** Was anything observed AFTER the last file change? A turn with no file change armed the gate through a build
   *  tool that isn't a mutation (e.g. bash) — it executed something, which is itself an observation. */
  private observedAfterLastMutation(tools: { name: string }[]): boolean {
    let last = -1;
    tools.forEach((c, i) => { if (this.mutateTools.has(c.name)) last = i; });
    if (last === -1) return true;
    return tools.slice(last + 1).some((c) => this.observeTools.has(c.name));
  }

  /** Every file change this turn touched only prose/doc files (and at least one did). */
  private docOnlyMutations(tools: { name: string; input: Record<string, unknown> }[]): boolean {
    const paths = tools
      .filter((c) => this.mutateTools.has(c.name))
      .map((c) => String(c.input.path ?? c.input.file_path ?? "").toLowerCase());
    return paths.length > 0 && paths.every((p) => DOC_EXTENSIONS.some((ext) => p.endsWith(ext)));
  }
}

/** A completion word counts only inside a short, declarative clause — not buried in prose. */
function assertiveClaim(text: string): boolean {
  return text.split(/[.!?\n]+/).some((raw) => {
    const s = raw.trim();
    return !!s && s.split(/\s+/).length <= 12 && CLAIM.test(s.toLowerCase());
  });
}

export function createDoneGate(buildTools?: string[], observeTools?: string[], verifyHint?: string, mutateTools?: string[]): DoneGate {
  return new DoneGate(buildTools, observeTools, verifyHint, mutateTools);
}
