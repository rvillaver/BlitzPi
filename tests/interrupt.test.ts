/**
 * Escape must interrupt a busy turn, and must change nothing else.
 *
 * The live half of this is recorded in the branch's own commit: driven under a real pty, a bare ESC
 * reaches `handleInput` as `"\x1b"` and the trace reports `ESC seen, idle=true`. What a test can pin
 * is the branch logic that live run cannot reach without a model turn — that ESC **while busy** aborts
 * and swallows the key, and that every other case still falls through to Pi's own editor. The carve-out
 * for escape SEQUENCES is the one most likely to be broken by a later edit: arrow keys arrive as
 * `"\x1b[A"` in the same chunk, and taking those would break navigation for everyone.
 */
const superCalls: string[] = [];

// `virtual: true`: the package ships ESM-only exports (no `require` condition), so jest's CJS
// resolver cannot find it and a plain `jest.mock` fails to resolve. Nothing real is loaded here
// anyway — this test is about our subclass's branch, not Pi's editor.
jest.mock("@earendil-works/pi-coding-agent", () => ({
  // Stands in for Pi's editor. Only `handleInput` matters here: the real one is reached through
  // `super`, so recording the calls is exactly the "fell through untouched" assertion.
  CustomEditor: class {
    constructor(public tui: unknown, public theme: unknown, public keybindings: unknown) {}
    handleInput(data: string): void { superCalls.push(data); }
  },
}), { virtual: true });

import { installInterrupt } from "../src/interrupt";

type Editor = { handleInput(data: string): void };

/** Install the extension and return the editor it supplies, plus the spies it was built against. */
function editorFor(opts: { idle: boolean; hasUI?: boolean }) {
  const abort = jest.fn();
  const audited: string[] = [];
  let factory: ((tui: unknown, theme: unknown, kb: unknown) => Editor) | undefined;
  const ctx = {
    hasUI: opts.hasUI ?? true,
    isIdle: () => opts.idle,
    abort,
    ui: { setEditorComponent: (f: typeof factory) => { factory = f; } },
  };
  let onSessionStart: ((e: unknown, c: unknown) => unknown) | undefined;
  const pi = { on: (event: string, h: typeof onSessionStart) => { if (event === "session_start") onSessionStart = h; } };

  installInterrupt(pi as never, (what) => audited.push(what));
  expect(onSessionStart).toBeDefined();
  onSessionStart!(null, ctx);
  return { factory, abort, audited, editor: factory ? factory({}, {}, {}) : undefined };
}

beforeEach(() => { superCalls.length = 0; });

describe("escape interrupts a turn that has already run a tool", () => {
  test("a headless run installs no editor — there is no escape key to take", () => {
    const { factory } = editorFor({ idle: true, hasUI: false });
    expect(factory).toBeUndefined();
  });

  test("ESC while BUSY aborts the run, and the key goes no further", () => {
    const { editor, abort, audited } = editorFor({ idle: false });
    editor!.handleInput("\x1b");
    expect(abort).toHaveBeenCalledTimes(1);
    expect(audited).toEqual(["escape"]);
    expect(superCalls).toEqual([]); // swallowed: Pi never sees it
  });

  test("ESC while IDLE is Pi's, not ours — clearing the editor must still work", () => {
    const { editor, abort, audited } = editorFor({ idle: true });
    editor!.handleInput("\x1b");
    expect(abort).not.toHaveBeenCalled();
    expect(audited).toEqual([]);
    expect(superCalls).toEqual(["\x1b"]);
  });

  test.each([
    ["an arrow key", "\x1b[A"],
    ["an alt-chord", "\x1bb"],
    ["bracketed paste", "\x1b[200~hi\x1b[201~"],
  ])("%s reaches the editor untouched even while busy — it is a sequence, not a bare ESC", (_label, data) => {
    const { editor, abort } = editorFor({ idle: false });
    editor!.handleInput(data);
    expect(abort).not.toHaveBeenCalled();
    expect(superCalls).toEqual([data]);
  });

  test("ordinary typing while busy is still typing", () => {
    const { editor, abort } = editorFor({ idle: false });
    editor!.handleInput("x");
    expect(abort).not.toHaveBeenCalled();
    expect(superCalls).toEqual(["x"]);
  });
});
