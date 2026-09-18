import { DoneGate, type ToolCall } from "../src/goodbehavior/done-gate";

const call = (name: string, path?: string): ToolCall => ({ name, input: path ? { path } : {} });
// The shipped development profile: bash both builds and observes; ordering is keyed on edit/write.
const dev = () => new DoneGate(["edit", "write", "bash"], ["bash", "powershell"], "run the program");

describe("done-gate — the original mechanism", () => {
  test("(3) a turn that built nothing is never gated", () => {
    expect(dev().check("All done.", [call("read")]).blocked).toBe(false);
  });

  test("a bare completion claim after building is pushed back, with the profile's hint", () => {
    const r = dev().check("All done.", [call("edit", "src/a.ts"), call("bash")]);
    expect(r.blocked).toBe(true);
    expect(r.feedback).toContain("run the program");
  });

  test("(0a) an honest hedge always passes — even with no observation", () => {
    expect(dev().check("Done, but unverified.", [call("edit", "src/a.ts")]).blocked).toBe(false);
  });

  test("(1) talking about the gate is not a claim", () => {
    expect(dev().check("The done-gate is done.", [call("edit", "src/a.ts")]).blocked).toBe(false);
  });

  test("(2) a completion word buried in a long sentence is not a claim", () => {
    const long = "I looked at how the parser handles the case where the input is done streaming and found nothing odd there";
    expect(dev().check(long, [call("edit", "src/a.ts")]).blocked).toBe(false);
  });

  describe("(0b) proof vocabulary is honored only when behavior backs it", () => {
    test("edit → bash → 'verified, done' passes", () => {
      expect(dev().check("Verified. Done.", [call("edit", "src/a.ts"), call("bash")]).blocked).toBe(false);
    });

    test("bash → edit → 'verified, done' is a hollow proof: the final state was never observed", () => {
      const r = dev().check("Verified. Done.", [call("bash"), call("edit", "src/a.ts")]);
      expect(r.blocked).toBe(true);
      expect(r.reason).toMatch(/after the last change/);
    });

    test("bash alone arms the gate, and is itself an observation", () => {
      expect(dev().check("Tests pass. Done.", [call("bash")]).blocked).toBe(false);
    });

    test("doc-only changes skip the behavioral check", () => {
      expect(dev().check("Verified. Done.", [call("bash"), call("write", "README.md")]).blocked).toBe(false);
    });

    test("a code change mixed in with docs is not doc-only", () => {
      expect(dev().check("Verified. Done.", [call("write", "README.md"), call("edit", "src/a.ts")]).blocked).toBe(true);
    });

    test("a mutating tool listed as observe does not observe its own change", () => {
      const g = new DoneGate(["edit", "write"], ["edit", "read"]);
      expect(g.check("Verified. Done.", [call("edit", "src/a.ts")]).blocked).toBe(true);
      expect(g.check("Verified. Done.", [call("edit", "src/a.ts"), call("read")]).blocked).toBe(false);
    });
  });

  test("mutate_tools is profile-configurable", () => {
    const g = new DoneGate(["apply_patch", "bash"], ["bash"], undefined, ["apply_patch"]);
    expect(g.check("Verified. Done.", [call("bash"), call("apply_patch", "x.py")]).blocked).toBe(true);
    expect(g.check("Verified. Done.", [call("apply_patch", "x.py"), call("bash")]).blocked).toBe(false);
  });
});

describe("done-gate wiring — feedback reaches the model, once per turn", () => {
  const { mkdtempSync } = require("node:fs");
  const { tmpdir } = require("node:os");
  const { join } = require("node:path");

  function harness() {
    const handlers: Record<string, Function[]> = {};
    const sent: any[] = [];
    const pi: any = {
      on: (ev: string, fn: Function) => { (handlers[ev] ??= []).push(fn); },
      registerCommand: () => {},
      sendMessage: (msg: any, opts: any) => sent.push({ msg, opts }),
    };
    const cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), "gb-gate-")));
    try {
      require("../src/goodbehavior").setupGoodBehavior(pi, {} as any);
    } finally {
      process.chdir(cwd);
    }
    const fire = (ev: string, event: any = {}) => (handlers[ev] ?? []).forEach((fn) => fn(event, { hasUI: false }));
    const claim = (text: string) => ({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] });
    return { fire, sent, claim };
  }

  test("an unbacked claim queues the feedback as a follow-up turn, and a stubborn repeat is not re-gated", () => {
    const { fire, sent, claim } = harness();
    fire("input", { text: "make hello.py" });
    fire("tool_call", { toolName: "write", input: { path: "hello.py" } });
    fire("agent_end", claim("Verified. Done."));
    expect(sent).toHaveLength(1);
    expect(sent[0].opts).toEqual({ deliverAs: "followUp", triggerTurn: true });
    expect(String(sent[0].msg.content)).toMatch(/observed NOTHING after its last file change/);

    // The continuation: same claim, still nothing run. One fire per turn — no loop.
    fire("tool_call", { toolName: "write", input: { path: "hello.py" } });
    fire("agent_end", claim("Verified. Done."));
    expect(sent).toHaveLength(1);

    // The next human turn is gated again.
    fire("input", { text: "again" });
    fire("tool_call", { toolName: "edit", input: { path: "hello.py" } });
    fire("agent_end", claim("Verified. Done."));
    expect(sent).toHaveLength(2);
  });

  test("only the LAST assistant message is judged", () => {
    const { fire, sent } = harness();
    fire("input", { text: "x" });
    fire("tool_call", { toolName: "edit", input: { path: "a.ts" } });
    fire("agent_end", { messages: [
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
      { role: "assistant", content: [{ type: "text", text: "Not done yet — the build still fails." }] },
    ] });
    expect(sent).toHaveLength(0);
  });
});
