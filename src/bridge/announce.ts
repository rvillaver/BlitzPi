/**
 * A session announcing itself to the bridge (CHAT-BRIDGE B17/B18).
 *
 * The daemon has never had a way to know a user's terminal session exists — `BLITZ_BRIDGE_SOCKET` flows *outward*
 * into children it spawns, and nothing flows back. So a chat message and a terminal could both be driving agents
 * in one directory with neither aware of the other. This is the missing inbound half.
 *
 * **Deliberately not a `pi.on()` handler.** An identical `pi.on("session_start", …)` registered from this module
 * never fired, while the same registration from `src/setup/index.ts` did — proven with filesystem breadcrumbs in
 * one process: registration here completed, the handler was never invoked, and moving the body into the setup
 * flow's handler made it work immediately. The cause is NOT understood; bisection eliminated the handler body,
 * the signal listeners, and `require` vs a top-level import. Rather than ship behaviour that depends on a
 * mechanism I cannot explain, the logic is a plain function called from a handler known to fire.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BindingsStore } from "./bindings";
import { SessionRegistry } from "./sessions";
import { debug } from "../log";

let registeredPid: number | undefined;

/** Drop this session from the registry. Safe to call repeatedly. */
export function dropSession(registry = new SessionRegistry()): void {
  if (registeredPid === undefined) return;
  try { registry.deregister(registeredPid); } catch { /* best effort */ }
  registeredPid = undefined;
}

/**
 * Register this session and, if its project is bound to a conversation, say so.
 *
 * Call from a `session_start` handler. Returns the warning text (if any) so it is testable without a TUI.
 */
export function announceSession(
  ctx: Pick<ExtensionContext, "mode" | "hasUI" | "ui">,
  cwd = process.cwd(),
  registry = new SessionRegistry(),
  bindings = new BindingsStore(),
): string | undefined {
  // Only a human's terminal counts. A bridge-spawned child already has BLITZ_BRIDGE_CONV, and counting it would
  // make every chat run look like a collision with itself; print/rpc runs are nobody's open session.
  if (process.env.BLITZ_BRIDGE_CONV || ctx.mode !== "tui") return undefined;

  try {
    registry.register({ project: cwd, pid: process.pid, mode: ctx.mode });
    registeredPid = process.pid;
    debug(`[Blitz:Bridge] session registered for ${cwd}`);
  } catch (e) {
    debug(`[Blitz:Bridge] could not register session: ${(e as Error).message}`);
    return undefined;
  }

  // B18: until attach-only routing lands (B21), a chat message runs a SEPARATE agent in this same directory.
  // Finding that out by way of surprising edits is the worst way to learn it.
  try {
    const bound = bindings.byProject(cwd);
    if (!bound) return undefined;
    const others = registry.forProject(cwd).filter((s) => s.pid !== process.pid);
    const also = others.length
      ? ` ${others.length} other BlitzPi session${others.length > 1 ? "s are" : " is"} also open here (pid ${others.map((s) => s.pid).join(", ")}).`
      : "";
    const msg = `This project is bound to ${bound.conv.platform}:${bound.conv.id} — messages there run their own agent in this same directory.${also}`;
    if (ctx.hasUI) ctx.ui.notify(msg, others.length ? "warning" : "info");
    return msg;
  } catch { return undefined; } // the warning is a courtesy; never let it break startup
}
