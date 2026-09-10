/**
 * Regression tests for the /loop command.
 *
 * Each test targets a defect found in the original implementation (57098d9f):
 *  1. the handler ran the whole loop inline, wedging Pi's editor submit path;
 *  2. waitForIdle() was called on an un-awaited send, so it returned before the
 *     turn began and iterations stacked up on the follow-up queue;
 *  3. [STOP_LOOP] was only looked for in the very last entry, which after a turn
 *     with tool calls is usually not the assistant message;
 *  4. a rejected send became an unhandled rejection instead of stopping the loop.
 */
import { setupLoop } from "../src/loop";

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(entries: any[] = []) {
  const sends: Deferred[] = [];
  const notifications: Array<{ message: string; level: string }> = [];
  let handler!: (args: string, ctx: any) => Promise<void>;

  const pi = {
    registerCommand: (_name: string, opts: any) => {
      handler = opts.handler;
    },
    sendUserMessage: jest.fn(() => {
      const d = deferred();
      sends.push(d);
      return d.promise;
    }),
  };

  const ctx = {
    ui: {
      setStatus: jest.fn(),
      notify: jest.fn((message: string, level: string) => {
        notifications.push({ message, level });
      }),
    },
    sessionManager: { getEntries: () => entries },
    waitForIdle: jest.fn(() => Promise.resolve()),
  };

  setupLoop(pi as any);
  return { pi, ctx, sends, notifications, run: (args: string) => handler(args, ctx) };
}

const assistant = (text: string) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const toolResult = () => ({ type: "message", message: { role: "tool", content: [] } });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(async () => {
  // Cancel any loop left running so it cannot leak into the next test.
  jest.useRealTimers();
});

describe("/loop", () => {
  it("returns from the command handler while an iteration is still in flight", async () => {
    const h = harness();

    // Pi awaits this handler inside AgentSession.prompt(); if it does not settle,
    // the editor stays blocked. The send is deliberately left unresolved.
    await expect(h.run('30s "check status"')).resolves.toBeUndefined();

    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    await h.run("stop");
  });

  it("does not start the next iteration until the previous send has resolved", async () => {
    const h = harness();
    await h.run('30s "check status"');
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);

    // Interval elapses twice over while iteration 1 is still running.
    await jest.advanceTimersByTimeAsync(90_000);
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);

    // Only once the turn completes does the interval start counting.
    h.sends[0].resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(2);

    await h.run("stop");
  });

  it("honours [STOP_LOOP] when the assistant message is not the final entry", async () => {
    const entries: any[] = [];
    const h = harness(entries);
    await h.run('30s "check status"');

    // A turn that ended on a tool result, with the stop signal one entry earlier.
    entries.push(assistant("all clear [STOP_LOOP]"), toolResult());
    h.sends[0].resolve();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.notifications.some((n) => n.message.includes("[STOP_LOOP]"))).toBe(true);
  });

  it("stops and reports when a send rejects, without scheduling another turn", async () => {
    const h = harness();
    await h.run('30s "check status"');

    h.sends[0].reject(new Error("Authentication failed"));
    await jest.advanceTimersByTimeAsync(60_000);

    expect(h.pi.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(h.notifications.some((n) => n.level === "error" && n.message.includes("Authentication failed"))).toBe(true);
  });
});
