/** A terminal "platform": what `blitzpi bridge run` and a platform-less daemon render to. Questions are answered on a TTY. */
import readline from "node:readline";
import type { UiRequest, UiResponse } from "./rpc-host";
import type { AdapterCapabilities, ChatAdapter, ConvRef, Message, ThreadRef, Trigger, UserRef } from "./types";

export class ConsoleAdapter implements ChatAdapter {
  readonly platform = "console";
  readonly capabilities: AdapterCapabilities = { threads: false, buttons: 0, selectMenu: 0, modal: false, messageChars: 4000, paceWindowMs: 250, attachmentBytes: 0, seesAllMessages: false };
  private triggerCb?: (t: Trigger) => void;
  constructor(private out: (line: string) => void = (l) => process.stdout.write(l + "\n"), private interactive = !!process.stdin.isTTY) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onTrigger(cb: (t: Trigger) => void): void { this.triggerCb = cb; }
  trigger(t: Trigger): void { this.triggerCb?.(t); }
  async openThread(conv: ConvRef, _name: string, _existingId?: string): Promise<ConvRef> { return conv; }
  async post(target: ConvRef | ThreadRef, text: string, _opts?: { replyTo?: string }): Promise<void> { this.out(`[${target.id}] ${text}`); }
  async ask(target: ConvRef | ThreadRef, req: UiRequest, _canAnswer: (u: UserRef) => boolean): Promise<UiResponse | undefined> {
    const opts = req.options ?? [];
    this.out(`[${target.id}] ❓ ${req.title ?? req.message ?? "?"}${opts.length ? "\n" + opts.map((o, i) => `   ${i + 1}. ${o}`).join("\n") : ""}`);
    if (!this.interactive) { this.out(`[${target.id}]    (no terminal to answer on — the request will time out on the agent side)`); return undefined; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((res) => rl.question(opts.length ? "   pick a number (or type): " : "   answer: ", res));
    rl.close();
    if (req.method === "confirm") return { confirmed: /^(y|yes|1)$/i.test(answer.trim()) };
    const n = Number(answer.trim());
    if (opts.length && n >= 1 && n <= opts.length) return { value: opts[n - 1] };
    return answer.trim() ? { value: answer.trim() } : { cancelled: true };
  }
  async recent(): Promise<Message[]> { return []; }
  async postFiles(target: ConvRef | ThreadRef, files: { path: string; name: string }[], text?: string): Promise<void> { this.out(`[${target.id}] ${text ?? "📎"} ${files.map((f) => f.path).join(", ")}`); }
  identity(u: UserRef): string { return `console:${u.id}`; }
}
