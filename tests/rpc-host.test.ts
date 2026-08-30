/** RpcHost against a scripted JSONL child (tests/tools/fake-rpc.ts). */
import path from "node:path";
import { RpcHost, type RpcEvent } from "../src/bridge/rpc-host";

const FAKE = [process.env.BUN_BIN ?? "bun", path.join(__dirname, "tools", "fake-rpc.ts")];
const mk = (extra: Partial<ConstructorParameters<typeof RpcHost>[0]> = {}) => { const events: RpcEvent[] = []; const h = new RpcHost({ project: process.cwd(), command: FAKE, session: false, onEvent: (e) => events.push(e), ...extra }); return { h, events }; };
const settled = (events: RpcEvent[]) => new Promise<void>((res) => { const t = setInterval(() => { if (events.some((e) => e.type === "agent_settled")) { clearInterval(t); res(); } }, 20); });

describe("RpcHost", () => {
  test("starts (ready on the first response), streams events, answers, stops", async () => {
    const { h, events } = mk();
    await h.start(); expect(h.state).toBe("ready");
    const r = await h.prompt("hello"); expect(r.success).toBe(true);
    await settled(events);
    expect(events.filter((e) => e.type === "message_update").map((e: any) => e.assistantMessageEvent.delta).join("")).toBe("Hello world");
    expect((await h.getLastAssistantText()).data).toEqual({ text: "Hello world" });
    await h.stop(); expect(h.state).toBe("stopped");
  });
  test("routes a select request to the asker and sends the response back", async () => {
    const asked: any[] = [];
    const { h, events } = mk({ onUiRequest: async (req) => { asked.push(req); return { value: "B" }; } });
    await h.start(); await h.prompt("please ask me"); await settled(events);
    expect(asked[0]).toMatchObject({ method: "select", title: "Pick", options: ["A", "B"] });
    expect(events.find((e) => e.type === "tool_execution_end")).toMatchObject({ result: { content: [{ text: "User selected: B" }] } });
    await h.stop();
  });
  test("a failed command rejects; an unexpected exit rejects pending requests and reports unexpected=true", async () => {
    const exits: [number | null, boolean][] = [];
    const { h } = mk({ maxRestarts: 0, onExit: (c, u) => exits.push([c, u]) });
    await h.start();
    await expect(h.request({ type: "nope" })).rejects.toThrow(/unknown command/);
    await expect(h.prompt("crash now").then(() => h.getLastAssistantText())).rejects.toThrow(/exited/);
    await new Promise((r) => setTimeout(r, 100));
    expect(exits).toEqual([[3, true]]); expect(h.state).toBe("stopped");
  });
  test("idle stop", async () => {
    const { h } = mk({ idleMs: 200 });
    await h.start(); expect(h.state).toBe("ready");
    await new Promise((r) => setTimeout(r, 600));
    expect(h.state).toBe("stopped");
  });
});
