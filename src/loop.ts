/**
 * Loop extension: repeat a prompt at an interval until the agent signals [STOP_LOOP]
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export function setupLoop(pi: ExtensionAPI): void {

  pi.registerCommand("loop", {
    description: "Repeat a prompt at an interval until agent signals [STOP_LOOP]. Usage: /loop <interval> \"<prompt>\"",
    handler: async (args: string, ctx) => {
      const match = args.match(/^(\d+(?:\.\d+)?[smh])\s+"(.+)"$/i);
      if (!match) {
        ctx.ui.notify("Usage: /loop <interval> \"<prompt>\" (e.g., /loop 30s \"check status\")", "error");
        return;
      }

      const [, intervalStr, prompt] = match;
      const intervalMs = parseInterval(intervalStr);
      if (intervalMs === null) {
        ctx.ui.notify("Invalid interval. Use format: 30s, 5m, 1h", "error");
        return;
      }

      ctx.ui.setStatus("loop", `Looping every ${intervalStr}. Include [STOP_LOOP] in response to stop.`);

      try {
        let stopped = false;
        let iterations = 0;

        while (!stopped && !ctx.signal?.aborted) {
          iterations++;
          ctx.ui.setStatus("loop", `Loop iteration ${iterations}...`);

          pi.sendUserMessage(prompt, { deliverAs: "followUp" });
          await ctx.waitForIdle();

          // Check the last message in the session for [STOP_LOOP]
          const entries = ctx.sessionManager.getEntries();
          if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            // The last entry should be an assistant message if it just responded
            if (lastEntry.type === "message" && "message" in lastEntry && lastEntry.message.role === "assistant") {
              if (hasStopLoop(lastEntry.message)) {
                stopped = true;
                ctx.ui.notify(
                  `Loop stopped after ${iterations} iteration(s). Agent signaled [STOP_LOOP].`,
                  "info"
                );
                break;
              }
            }
          }

          // Wait for the interval before the next iteration
          if (!stopped && !ctx.signal?.aborted) {
            await sleep(intervalMs);
          }
        }

        if (ctx.signal?.aborted && !stopped) {
          ctx.ui.notify(`Loop cancelled after ${iterations} iteration(s).`, "warning");
        }
      } finally {
        ctx.ui.setStatus("loop", undefined);
      }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
