/**
 * One dialog at a time.
 *
 * Pi's `showExtensionSelector` keeps no queue: a second concurrent `ui.select()` assigns over
 * `this.extensionSelector`, calls `editorContainer.clear()` and focuses the new component, while
 * `disposeActiveSelector()` only touches a different field. The first dialog is orphaned — off the
 * render tree, never disposed, **its promise never resolved**. Whatever awaited it never returns.
 *
 * That is how a session wedges completely: two parallel `bash` calls, one of them needing an ask
 * (a container CLI reaching the daemon socket), and the `tool_call` hook chain stops forever with no
 * `bash_exec` ever logged. Ctrl+C cannot save it — in Pi ctrl+c is "clear editor" and escape is the
 * interrupt — and the gate passed no signal, so nothing could cancel the ask either.
 *
 * Verified 2026-09-10 with a PTY probe firing two `ui.select` calls 50 ms apart: the second renders
 * mangled into the status bar, the first never resolves, and four Enters and a wait do not recover it.
 * With a `timeout` the orphan does still resolve (undefined) — that is the backstop below, not the fix.
 *
 * So: every ask BlitzPi makes goes through this queue, and tool-time asks also carry a ceiling, so a
 * dialog that gets lost anyway degrades to a deny instead of a hang.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Structural minimum: anything carrying Pi's dialog surface. The setup flow hands its steps a narrowed
 *  `StepContext` (cwd + ui + interactive) rather than the whole ExtensionContext, and it asks too. */
export interface AskHost {
  ui: ExtensionContext["ui"];
  signal?: AbortSignal;
}

/** Backstop for asks raised while the agent is running: a lost dialog must not hang a run forever.
 *  Matches the bash command ceiling (`DEFAULT_COMMAND_TIMEOUT_MS`). Deliberately generous — with the
 *  queue below it should never be reached, and a user who stepped away should still get to answer. */
export const ASK_CEILING_MS = 10 * 60_000;

export interface AskOptions {
  signal?: AbortSignal;
  /** ms; omit for asks with no agent run waiting on them (setup, onboarding, an explicit command). */
  timeout?: number;
}

/** Asks settle in the order they were raised. A single caller pays nothing; concurrent callers queue. */
let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn); // a previous ask's rejection must not skip this one
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** `ctx.signal` is a getter that asserts the extension is active; never let it break an ask. */
function signalOf(ctx: AskHost | undefined): AbortSignal | undefined {
  try {
    return ctx?.signal;
  } catch {
    return undefined;
  }
}

/** Escape (Pi's `app.interrupt`) aborts the agent run; passing its signal is what makes a pending
 *  ask cancellable at all. Without it the ask outlives the run it was blocking. */
function dialogOpts(ctx: AskHost | undefined, opts?: AskOptions) {
  return { signal: opts?.signal ?? signalOf(ctx), timeout: opts?.timeout };
}

export function askSelect(
  ctx: AskHost,
  title: string,
  options: string[],
  opts?: AskOptions
): Promise<string | undefined> {
  return enqueue(() => ctx.ui.select(title, options, dialogOpts(ctx, opts)));
}

export function askInput(
  ctx: AskHost,
  title: string,
  placeholder?: string,
  opts?: AskOptions
): Promise<string | undefined> {
  return enqueue(() => ctx.ui.input(title, placeholder, dialogOpts(ctx, opts)));
}

/** Test seam: the queue is module state, and a test that leaves an ask pending would stall the next. */
export function resetAskQueueForTests(): void {
  chain = Promise.resolve();
}
