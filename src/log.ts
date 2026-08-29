/** Runtime diagnostics. Hooks must not write to the console while Pi's TUI is mounted
 *  (it draws raw text over the UI) — decisions go to the audit log and ctx.ui; this is opt-in. */
export function debug(...args: unknown[]): void {
  if (process.env.BLITZ_DEBUG) console.error("[Blitz:debug]", ...args);
}
