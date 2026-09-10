/**
 * The dialog queue (src/ui-ask.ts). Pi's showExtensionSelector keeps no queue: a second concurrent
 * ui.select() clears the editor container and focuses the new component, orphaning the first — its
 * promise never resolves, and whatever awaited it (a tool_call hook) wedges the session forever.
 * Verified live on 2026-09-10; see .claude memory `concurrent-dialogs-orphan-and-wedge`.
 */
import fs from "fs";
import path from "path";
import { askSelect, askInput, resetAskQueueForTests, ASK_CEILING_MS } from "../src/ui-ask";

/** A stand-in for Pi's TUI with the orphaning behaviour it actually has: only the MOST RECENTLY opened
 *  dialog can ever be answered; anything opened before it is dropped and never settles. */
function orphaningUi() {
  const opened: { title: string; settle: (v: string | undefined) => void }[] = [];
  const ui = {
    select: (title: string, _options: string[], opts?: { signal?: AbortSignal; timeout?: number }) =>
      new Promise<string | undefined>((resolve) => {
        opened.push({ title, settle: resolve });
        seen.push({ title, timeout: opts?.timeout, hasSignal: !!opts?.signal });
      }),
    input: (title: string, _p?: string, opts?: { signal?: AbortSignal; timeout?: number }) =>
      new Promise<string | undefined>((resolve) => {
        opened.push({ title, settle: resolve });
        seen.push({ title, timeout: opts?.timeout, hasSignal: !!opts?.signal });
      }),
    confirm: async () => false,
    notify: () => {},
  } as any;
  const seen: { title: string; timeout?: number; hasSignal: boolean }[] = [];
  /** Answer the frontmost dialog, the way a user pressing enter does. */
  const answerNewest = (value: string | undefined) => {
    const d = opened[opened.length - 1];
    if (!d) throw new Error("no dialog is open");
    d.settle(value);
  };
  return { ui, seen, opened, answerNewest };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetAskQueueForTests());

test("two concurrent asks both resolve — the first is not orphaned", async () => {
  const { ui, opened, answerNewest } = orphaningUi();
  const ctx = { ui } as any;

  const a = askSelect(ctx, "ASK-A", ["Yes", "No"]);
  await tick();
  const b = askSelect(ctx, "ASK-B", ["Yes", "No"]);
  await tick();

  // Only one dialog is ever on screen, so the second cannot displace the first.
  expect(opened.map((d) => d.title)).toEqual(["ASK-A"]);
  answerNewest("Yes");
  expect(await a).toBe("Yes");

  await tick();
  expect(opened.map((d) => d.title)).toEqual(["ASK-A", "ASK-B"]);
  answerNewest("No");
  expect(await b).toBe("No");
});

test("a rejected ask does not strand the ones queued behind it", async () => {
  const ctx = {
    ui: { select: () => Promise.reject(new Error("boom")), notify: () => {} },
  } as any;
  await expect(askSelect(ctx, "first", ["a"])).rejects.toThrow("boom");

  const { ui, answerNewest } = orphaningUi();
  const after = askSelect({ ui } as any, "second", ["a"]);
  await tick();
  answerNewest("a");
  expect(await after).toBe("a");
});

test("askSelect passes ctx.signal so escape can cancel a pending ask", async () => {
  const { ui, seen } = orphaningUi();
  const signal = new AbortController().signal;
  void askSelect({ ui, signal } as any, "with-signal", ["a"]);
  await tick();
  expect(seen[0].hasSignal).toBe(true);
});

test("a context without a signal (the setup flow's StepContext) still asks", async () => {
  const { ui, seen, answerNewest } = orphaningUi();
  const p = askInput({ ui } as any, "no-signal", "");
  await tick();
  expect(seen[0].hasSignal).toBe(false);
  answerNewest("typed");
  expect(await p).toBe("typed");
});

test("the ceiling is a real bound, not zero or infinite", () => {
  expect(ASK_CEILING_MS).toBeGreaterThan(60_000);
  expect(Number.isFinite(ASK_CEILING_MS)).toBe(true);
});

/** The queue only works if everything uses it. A direct ctx.ui.select() reintroduces the wedge. */
test("no module asks Pi for a dialog directly — every ask goes through ui-ask", () => {
  const root = path.join(__dirname, "..", "src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && e.name !== "ui-ask.ts") {
        const src = fs.readFileSync(p, "utf-8");
        for (const m of src.matchAll(/\.ui\.(select|input)\(/g)) {
          offenders.push(`${path.relative(root, p)} → .ui.${m[1]}(`);
        }
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
