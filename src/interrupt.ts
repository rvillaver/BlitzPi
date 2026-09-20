/**
 * Escape interrupts a turn — including one that has already run a tool.
 *
 * Pi binds escape on the **editor object** (`defaultEditor.onEscape`), not as an app action
 * the way `app.clear` (ctrl+c) is bound. Measured 2026-09-20 against 1.2.126: once a turn
 * has completed a tool call, that handler stops taking effect. At the same instant, in the
 * same turn, typing still reaches the editor and **ctrl+c still clears it** — so the TUI is
 * alive and keys arrive; only escape does nothing. It takes no branch at all: no abort, and
 * two escapes 120 ms apart open no selector either. Sixty seconds later the turn is still
 * streaming.
 *
 * That is the reported bug: "once it started working, I couldn't cut it again" — and the only
 * way out was closing the app, because ctrl+c twice is `shutdown()`, not an interrupt.
 *
 * The abort machinery underneath is fine: `pi-agent-core`'s loop passes the same signal to
 * every stream including post-tool ones, and `ctx.abort()` aborts the active run. So this
 * does not reimplement interrupting — it just makes sure the key reaches it.
 *
 * `handleInput` sees raw bytes, below whatever is losing the key. We take escape **only when
 * the agent is busy**; every other case falls through to `super`, so clearing the editor,
 * leaving bash mode, dismissing a selector and double-escape all behave exactly as before.
 * Pi copies its own `onEscape`, `onCtrlD`, `onExtensionShortcut` and every app action handler
 * onto an extension's editor, so nothing else is lost by supplying one.
 */
import { appendFileSync } from "node:fs";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ESC = "\x1b";

/**
 * Opt-in diagnostics: `BLITZ_INTERRUPT_TRACE=<file>` records which step ran. Kept because
 * this fix is invisible when it works and indistinguishable from the original bug when it
 * does not — a failed run should say *where* it failed rather than "escape did nothing".
 */
function trace(what: string): void {
  const file = process.env.BLITZ_INTERRUPT_TRACE;
  if (!file) return;
  try { appendFileSync(file, `${new Date().toISOString()} ${what}\n`); } catch { /* tracing must never break a session */ }
}

export function installInterrupt(pi: ExtensionAPI, onAudit?: (what: string) => void): void {
  trace("installInterrupt called");
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    trace(`session_start hasUI=${ctx.hasUI} setEditorComponent=${typeof (ctx as any).ui?.setEditorComponent}`);
    if (!ctx.hasUI) return; // headless runs have no editor and no escape key

    try {
    ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
      trace("editor factory invoked");
      class InterruptingEditor extends CustomEditor {
        handleInput(data: string): void {
          // A bare ESC only. An escape SEQUENCE (arrow keys, alt-chords, bracketed paste)
          // arrives as more bytes in the same chunk and must reach the editor untouched.
          if (data === ESC) trace(`ESC seen, idle=${ctx.isIdle()}`);
          if (data === ESC && !ctx.isIdle()) {
            onAudit?.("escape");
            ctx.abort();
            return;
          }
          super.handleInput(data);
        }
      }
      return new InterruptingEditor(tui, theme, keybindings);
    });
    trace("setEditorComponent returned");
    } catch (error) {
      trace(`setEditorComponent threw: ${(error as Error).message}`);
    }
  });
}
