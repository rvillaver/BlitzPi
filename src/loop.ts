/**
 * Loop extension: repeat a prompt at an interval until the agent signals [STOP_LOOP].
 *
 * The command handler must return promptly: Pi awaits it inside AgentSession.prompt()
 * (core/agent-session.js), so anything long-running here wedges the editor's submit
 * path. Iterations are therefore driven by a background timer, not by the handler.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

interface LoopState {
  running: boolean;
  iterations: number;
  intervalMs: number;
  prompt: string;
  ctx: ExtensionCommandContext;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

let activeLoop: LoopState | null = null;

function hasStopLoop(message: any): boolean {
  if ("content" in message && Array.isArray(message.content)) {
    for (const block of message.content) {
      if ("text" in block && typeof block.text === "string") {
        if (block.text.includes("[STOP_LOOP]")) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * The last entry after a turn is often a tool result, not the assistant message,
 * so scan backwards for the most recent assistant message instead of peeking at
 * the tail — otherwise [STOP_LOOP] is silently missed and the loop never stops.
 */
function lastAssistantMessage(ctx: ExtensionCommandContext): any | null {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "message" && "message" in entry && entry.message.role === "assistant") {
      return entry.message;
    }
  }
  return null;
}

function scheduleNextIteration(loop: LoopState, pi: ExtensionAPI): void {
  if (!loop.running) return;
  loop.timeoutId = setTimeout(() => {
    loop.timeoutId = null;
    void runIteration(loop, pi);
  }, loop.intervalMs);
}

async function runIteration(loop: LoopState, pi: ExtensionAPI): Promise<void> {
  if (!loop.running) return;

  loop.iterations++;
  loop.ctx.ui.setStatus("loop", `Loop iteration ${loop.iterations}... (/loop stop to cancel)`);

  try {
    // Await the send: sendUserMessage resolves only once the turn it started has
    // finished. Firing it and calling waitForIdle() instead races — isIdle is
    // still true until _isAgentRunActive flips several awaits into prompt(), so
    // waitForIdle() returns immediately and iterations stack up on the queue.
    await pi.sendUserMessage(loop.prompt, { deliverAs: "followUp" });
    // Covers the other path: if the agent was already streaming, the message was
    // queued as a follow-up and the send returned without running it.
    await loop.ctx.waitForIdle();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    stopLoop(`Iteration failed: ${detail}`, "error");
    return;
  }

  if (!loop.running) return;

  const message = lastAssistantMessage(loop.ctx);
  if (message && hasStopLoop(message)) {
    stopLoop(`Agent signaled [STOP_LOOP] at iteration ${loop.iterations}.`);
    return;
  }

  scheduleNextIteration(loop, pi);
}

function stopLoop(reason: string, level: "info" | "warning" | "error" = "info"): void {
  if (!activeLoop) return;

  const { ctx, iterations, timeoutId } = activeLoop;
  activeLoop.running = false;
  if (timeoutId) clearTimeout(timeoutId);
  activeLoop = null;

  ctx.ui.setStatus("loop", undefined);
  ctx.ui.notify(`Loop stopped after ${iterations} iteration(s). ${reason}`, level);
}

export function setupLoop(pi: ExtensionAPI): void {
  pi.registerCommand("loop", {
    description:
      'Repeat a prompt at an interval until agent signals [STOP_LOOP]. Usage: /loop <interval> "<prompt>" or /loop stop',
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim().toLowerCase() === "stop") {
        if (activeLoop) {
          stopLoop("Cancelled by user.");
        } else {
          ctx.ui.notify("No loop is currently running.", "info");
        }
        return;
      }

      if (activeLoop) {
        ctx.ui.notify("A loop is already running. Use /loop stop to cancel it.", "warning");
        return;
      }

      const match = args.match(/^(\d+(?:\.\d+)?[smh])\s+"(.+)"$/i);
      if (!match) {
        ctx.ui.notify('Usage: /loop <interval> "<prompt>" (e.g. /loop 30s "check status") or /loop stop', "error");
        return;
      }

      const [, intervalStr, prompt] = match;
      const intervalMs = parseInterval(intervalStr);
      if (intervalMs === null) {
        ctx.ui.notify("Invalid interval. Use format: 30s, 5m, 1h", "error");
        return;
      }

      const loop: LoopState = {
        running: true,
        iterations: 0,
        intervalMs,
        prompt,
        ctx,
        timeoutId: null,
      };
      activeLoop = loop;

      ctx.ui.notify(`Loop started every ${intervalStr}. Type /loop stop to cancel.`, "info");
      ctx.ui.setStatus("loop", `Starting loop every ${intervalStr}...`);

      // Deliberately not awaited: the handler must return so Pi releases the editor.
      void runIteration(loop, pi);
    },
  });
}

function parseInterval(str: string): number | null {
  const match = str.match(/^(\d+(?:\.\d+)?)\s*([smh])$/i);
  if (!match) return null;

  const [, num, unit] = match;
  const value = parseFloat(num);

  switch (unit.toLowerCase()) {
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return null;
  }
}
