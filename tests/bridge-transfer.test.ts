/** File transfer in/out through the bridge: helpers, zones, and the core flow with a fake adapter. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { changedOut, ensureTransferDirs, inboundDir, inboundPath, isUnderOut, outboundDir, safeName, snapshotOut } from "../src/bridge/transfer";
import { classifyZone } from "../src/zones";
import { Bridge } from "../src/bridge/core";
import { BindingsStore } from "../src/bridge/bindings";
import { RpcHost } from "../src/bridge/rpc-host";
import type { AdapterCapabilities, Attachment, ChatAdapter, ConvRef, Message, ThreadRef, Trigger, UserRef } from "../src/bridge/types";

jest.setTimeout(30_000);
const FAKE = [process.env.BUN_BIN ?? "bun", path.join(__dirname, "tools", "fake-rpc.ts")];

test("helpers", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-xfer-"));
  ensureTransferDirs(project);
  expect(fs.readFileSync(path.join(project, ".blitz", "transfer", ".gitignore"), "utf8")).toBe("*\n");
  expect(safeName("my report (final).pdf")).toBe("my_report_final_.pdf"); expect(safeName("../../etc/passwd")).toBe("passwd"); expect(safeName("..\\evil\\..\\x.txt")).toBe("x.txt"); expect(safeName("")).toBe("file");
  expect(inboundPath(project, "123", "a b.txt")).toBe(path.join(inboundDir(project), "123-a_b.txt"));
  const before = snapshotOut(project); expect(changedOut(project, before)).toEqual([]);
  const f = path.join(outboundDir(project), "hello.txt"); fs.writeFileSync(f, "hi");
  expect(changedOut(project, before)).toEqual([f]);
  expect(changedOut(project, snapshotOut(project))).toEqual([]);
  expect(isUnderOut(project, ".blitz/transfer/out/x.png")).toBe(true); expect(isUnderOut(project, f)).toBe(true); expect(isUnderOut(project, ".blitz/transfer/in/x")).toBe(false);
  expect(classifyZone(".blitz/transfer/out/x.png", { project, install: "/i" })).toBe("project"); // no security-config prompt for deliveries
  expect(classifyZone(".blitz/blitz.config.yaml", { project, install: "/i" })).toBe("project-config");
});

class XferAdapter implements ChatAdapter {
  platform = "fake"; posts: string[] = []; files: { target: string; names: string[]; text?: string }[] = []; onStarted?: () => void;
  capabilities: AdapterCapabilities = { threads: true, buttons: 5, selectMenu: 25, modal: true, messageChars: 2000, paceWindowMs: 30, attachmentBytes: 1024 * 1024, seesAllMessages: false };
  private cb?: (t: Trigger) => void;
  async start() {} async stop() {} onTrigger(cb: (t: Trigger) => void) { this.cb = cb; } fire(t: Trigger) { this.cb!(t); }
  async openThread(conv: ConvRef, seed: Message): Promise<ThreadRef> { return { platform: "fake", id: `t-${seed.id}`, conv }; }
  async post(_t: ConvRef | ThreadRef, text: string) { this.posts.push(text); if (text.startsWith("▶ started")) this.onStarted?.(); }
  async ask() { return undefined; } async recent() { return []; } identity(u: UserRef) { return `fake:${u.id}`; }
  async download(file: Attachment, to: string) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, `content of ${file.name}`); return to; }
  async postFiles(target: ConvRef | ThreadRef, files: { path: string; name: string }[], text?: string) { this.files.push({ target: target.id, names: files.map((f) => f.name), text }); }
}
test("attachments land in .blitz/transfer/in and are named; files written to out/ are delivered once", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-xfer-run-"));
  const conv: ConvRef = { platform: "fake", id: "c" };
  const store = new BindingsStore(path.join(project, "bindings.json")); store.bind(conv, project, { operators: ["op"] });
  const adapter = new XferAdapter();
  const bridge = new Bridge({ bindings: store, hostFactory: (p, sid, env, hooks) => new RpcHost({ project: p, session: false, command: FAKE, env, idleMs: 0, ...hooks }) });
  bridge.attach(adapter);
  adapter.onStarted = () => { fs.writeFileSync(path.join(outboundDir(project), "report.md"), "# done"); }; // the agent "writes" during the run
  adapter.fire({ kind: "mention", conv, message: { id: "m1", author: { id: "op", name: "al" }, text: "look at this", time: 0, attachments: [{ name: "spec v2.pdf", url: "x", bytes: 10 }, { name: "huge.bin", url: "y", bytes: 5 * 1024 * 1024 }] }, text: "look at this" });
  await bridge.waitIdle(conv, 10_000);
  expect(fs.readFileSync(path.join(inboundDir(project), "m1-spec_v2.pdf"), "utf8")).toBe("content of spec v2.pdf");
  expect(adapter.posts.some((p) => p.includes("huge.bin is over the size limit"))).toBe(true);
  expect(adapter.files).toEqual([{ target: "t-m1", names: ["report.md"], text: "📎 report.md" }]);
  // same content again → not re-delivered; changed content → delivered
  adapter.onStarted = () => { fs.writeFileSync(path.join(outboundDir(project), "report.md"), "# done"); };
  adapter.fire({ kind: "mention", conv, message: { id: "m2", author: { id: "op" }, text: "again", time: 0 }, text: "again" });
  await bridge.waitIdle(conv, 10_000);
  expect(adapter.files).toHaveLength(1);
  adapter.onStarted = () => { fs.writeFileSync(path.join(outboundDir(project), "report.md"), "# changed"); };
  adapter.fire({ kind: "mention", conv, message: { id: "m3", author: { id: "op" }, text: "third", time: 0 }, text: "third" });
  await bridge.waitIdle(conv, 10_000);
  expect(adapter.files).toHaveLength(2);
  await bridge.stop();
});
