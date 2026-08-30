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
