/** Runtime diagnostics. Hooks must not write to the console while Pi's TUI is mounted
 *  (it draws raw text over the UI) — decisions go to the audit log and ctx.ui; this is opt-in. */
export function debug(...args: unknown[]): void {
  if (process.env.BLITZ_DEBUG) console.error("[Blitz:debug]", ...args);
}

/** Headless modes (`-p`, `--mode rpc|json`) own stdout — JSONL events or the answer text. Blitz's startup
 *  lines go to stderr there, and to stdout in the TUI (where Pi keeps them in the scrollback). */
export const HEADLESS: boolean = (() => {
  const a = process.argv;
  const i = a.indexOf("--mode");
  return a.includes("-p") || a.includes("--print") || (i >= 0 && (a[i + 1] === "rpc" || a[i + 1] === "json"));
})();
export function info(...args: unknown[]): void {
  (HEADLESS ? console.error : console.log)(...args);
}

/**
 * Startup chatter — which layer registered, in what mode.
 *
 * Worth reading in a terminal, worthless to a caller with no keyboard: a headless run is
 * parsed by a machine or a wrapper, and merging streams (a pty, `2>&1`, most CI captures and
 * agent harnesses) put twenty-odd lines in front of the first JSON object. What survives a
 * headless run is what a caller can act on — the one-line summary of the layers and their
 * modes, and whether the layer came up whole. The detail is in the audit trail and
 * `/blitz-security`, both of which outlive the run.
 */
export function note(...args: unknown[]): void {
  if (!HEADLESS) console.log(...args);
}
