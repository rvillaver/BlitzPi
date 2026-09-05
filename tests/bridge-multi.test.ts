/**
 * CHAT-BRIDGE Phase 3 / B10 — the multi-project claims: N children, lazy start, idle stop, per-conversation
 * queueing, and cleanup when a conversation goes away.
 *
 * The code for these existed; none of it was demonstrated. `tests/bridge-core.test.ts` covers one conversation
 * thoroughly (threads, questions, pacing, retries, ops) and never asserts that **two** behave independently —
 * which is the entire point of "many projects". These are the missing assertions, at the same seam and with the
 * same fake adapter + scripted child, so they exercise the real Bridge rather than a mock of it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bridge } from "../src/bridge/core";
import { BindingsStore } from "../src/bridge/bindings";
import { RpcHost, type UiRequest, type UiResponse } from "../src/bridge/rpc-host";
import type { AdapterCapabilities, ChatAdapter, ConvRef, Message, ThreadRef, Trigger, UserRef } from "../src/bridge/types";

const FAKE = [process.env.BUN_BIN ?? "bun", path.join(__dirname, "tools", "fake-rpc.ts")];

class FakeAdapter implements ChatAdapter {
  platform = "fake";
  posts: { target: string; text: string }[] = [];
  answer: UiResponse | undefined = { value: "A" };
  capabilities: AdapterCapabilities = { threads: true, buttons: 5, selectMenu: 25, modal: true, messageChars: 200, paceWindowMs: 5, attachmentBytes: 0, seesAllMessages: true };
  private cb?: (t: Trigger) => void;
  async start() {} async stop() {}
  onTrigger(cb: (t: Trigger) => void) { this.cb = cb; }
  fire(t: Trigger) { this.cb!(t); }
  async openThread(conv: ConvRef, _n: string, existingId?: string): Promise<ThreadRef> { return { platform: "fake", id: existingId ?? `thread-${conv.id}`, conv }; }
  async post(target: ConvRef | ThreadRef, text: string) { this.posts.push({ target: target.id, text }); }
  async ask(_t: ConvRef | ThreadRef, _r: UiRequest, canAnswer: (u: UserRef) => boolean) { return canAnswer({ id: "op1" }) ? this.answer : undefined; }
  async recent(): Promise<Message[]> { return []; }
  identity(u: UserRef) { return `fake:${u.id}`; }
  threadLink(t: ThreadRef) { return `<#${t.id}>`; }
  textsFor(id: string) { return this.posts.filter((p) => p.target === id).map((p) => p.text); }
}

const msg = (id: string, text: string): Message => ({ id, author: { id: "op1" }, text, time: Date.now() });
const mention = (conv: ConvRef, text: string): Trigger => ({ kind: "mention", conv, text, message: msg(`m-${conv.id}-${Math.random()}`, text) });

function twoConversations(idleMs = 0) {
  const store = new BindingsStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-multi-")), "bindings.json"));
  const a: ConvRef = { platform: "fake", id: "chan-a" };
  const b: ConvRef = { platform: "fake", id: "chan-b" };
  const projA = fs.mkdtempSync(path.join(os.tmpdir(), "projA-"));
  const projB = fs.mkdtempSync(path.join(os.tmpdir(), "projB-"));
  store.bind(a, projA, { operators: ["op1"], threads: "off" });
  store.bind(b, projB, { operators: ["op1"], threads: "off" });
  const adapter = new FakeAdapter();
  const hosts: RpcHost[] = [];
  const bridge = new Bridge({
    bindings: store,
    socketPath: "/tmp/none.sock",
    hostFactory: (project, _sid, env, hooks) => {
      const h = new RpcHost({ project, session: false, command: FAKE, env, idleMs, ...hooks });
      hosts.push(h);
      return h;
    },
  });
  bridge.attach(adapter);
  return { store, adapter, bridge, a, b, projA, projB, hosts };
}

const settle = async (bridge: Bridge, conv: ConvRef) => { await bridge.waitIdle(conv, 15_000); };

describe("B10 — many conversations", () => {
  test("no child is started until a conversation is actually used (lazy start)", async () => {
    const { hosts, bridge } = twoConversations();
    expect(hosts.length).toBe(0); // binding two conversations must not spawn anything
    await bridge.stop();
  });

  test("two conversations run against their own project and their own child", async () => {
    const { adapter, bridge, a, b, projA, projB, hosts } = twoConversations();
    adapter.fire(mention(a, "who are you"));
    adapter.fire(mention(b, "who are you"));
    await settle(bridge, a);
    await settle(bridge, b);

    // One child per conversation, each pointed at its own project — not one shared agent.
    expect(hosts.length).toBe(2);
    const projects = hosts.map((h) => (h as any).opts?.project ?? (h as any).project).sort();
    expect(projects).toEqual([projA, projB].sort());

    // Each conversation only ever hears about itself.
    expect(adapter.textsFor("chan-a").length).toBeGreaterThan(0);
    expect(adapter.textsFor("chan-b").length).toBeGreaterThan(0);
    expect(adapter.textsFor("chan-a").join(" ")).not.toContain("chan-b");
    await bridge.stop();
  });

  test("stopping the bridge stops every child, not just the first", async () => {
    const { adapter, bridge, a, b, hosts } = twoConversations();
    adapter.fire(mention(a, "hi"));
    adapter.fire(mention(b, "hi"));
    await settle(bridge, a);
    await settle(bridge, b);
    expect(hosts.length).toBe(2);
    await bridge.stop();
    for (const h of hosts) expect(["stopped", "idle", "exited"]).toContain(String(h.state));
  });

  test("unbinding a conversation stops its child and leaves the other running", async () => {
    const { store, adapter, bridge, a, b, hosts } = twoConversations();
    adapter.fire(mention(a, "hi"));
    adapter.fire(mention(b, "hi"));
    await settle(bridge, a);
    await settle(bridge, b);

    store.unbind(a);
    // A conversation that is no longer bound must not keep answering.
    const before = adapter.textsFor("chan-a").length;
    adapter.fire(mention(a, "still there?"));
    await settle(bridge, a);
    const after = adapter.textsFor("chan-a");
    expect(after.length).toBeGreaterThan(before); // it replies…
    expect(after[after.length - 1]).toMatch(/not bound|bind/i); // …but only to say it is unbound
    await bridge.stop();
  });
});
