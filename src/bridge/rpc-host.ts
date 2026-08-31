/**
 * RpcHost — one `blitzpi --mode rpc` child per project, driven over strict JSONL (LF only; never `readline`, which
 * also splits on U+2028/2029). Pi's shipped RpcClient has no `extension_ui_response` and hides stdin, so this is our
 * own thin client (CHAT-BRIDGE B2). Governance runs inside the child unchanged; this class only speaks the protocol.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export type RpcEvent = Record<string, unknown> & { type: string };
export interface UiRequest { id: string; method: string; title?: string; message?: string; options?: string[]; placeholder?: string; prefill?: string; timeout?: number; notifyType?: string; statusKey?: string; statusText?: string; widgetKey?: string; widgetLines?: string[]; text?: string }
export type UiResponse = { value: string } | { confirmed: boolean } | { cancelled: true };
export interface RpcHostOptions {
  /** Project directory the child runs in (its workspace). */
  project: string;
  /** Resume this Pi session id/path; omit for a new session; `false` for --no-session. */
  session?: string | false;
  /** Command to spawn (default: this install's `blitzpi`). */
  command?: string[];
  env?: NodeJS.ProcessEnv;
  /** Stop the child after this much idle time (ms); 0 = never. */
  idleMs?: number;
  /** Restart on an unexpected exit, up to this many times (backoff 1s, 2s, 4s…). */
  maxRestarts?: number;
  onEvent?: (ev: RpcEvent) => void;
  /** Dialog requests (select/confirm/input/editor). Return undefined to let the request time out on the agent side. */
  onUiRequest?: (req: UiRequest) => Promise<UiResponse | undefined>;
  onExit?: (code: number | null, unexpected: boolean) => void;
  onStderr?: (text: string) => void;
}
export type RpcState = "stopped" | "starting" | "ready" | "stopping";

export const REPO_ROOT = resolve(__dirname, "..", "..");
export function defaultCommand(): string[] { return [process.execPath, resolve(REPO_ROOT, "bin", "blitzpi.ts")]; }

export class RpcHost {
  state: RpcState = "stopped";
  private child?: ChildProcess;
  private buf = "";
  private seq = 0;
  private pending = new Map<string, { resolve: (r: RpcEvent) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private idleTimer?: NodeJS.Timeout;
  private restarts = 0;
  private stopping = false;
  private readyResolve?: () => void;
  constructor(readonly opts: RpcHostOptions) {}

  get pid(): number | undefined { return this.child?.pid; }

  async start(): Promise<void> {
    if (this.state === "ready" || this.state === "starting") return;
    this.state = "starting"; this.stopping = false;
    const [cmd, ...base] = this.opts.command ?? defaultCommand();
    const args = [...base, "--mode", "rpc"];
    if (this.opts.session === false) args.push("--no-session"); else if (this.opts.session) args.push("--session", this.opts.session);
    const child = spawn(cmd, args, { cwd: this.opts.project, env: { ...process.env, ...this.opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child; this.buf = "";
    child.stdin!.on("error", () => { /* child gone mid-write (EPIPE) — exit handling reports it */ });
    child.stdout!.on("data", (d: Buffer) => this.onData(d.toString("utf8")));
    child.stderr!.on("data", (d: Buffer) => this.opts.onStderr?.(d.toString("utf8")));
    child.on("exit", (code) => this.onChildExit(code));
    child.on("error", (e) => { this.failAll(e); this.state = "stopped"; });
    // ready = the child answers its first command
    await new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.request({ type: "get_state" }, 60_000).then(() => { this.state = "ready"; res(); }, rej);
    });
    this.touch();
  }

  async stop(): Promise<void> {
    if (!this.child) { this.state = "stopped"; return; }
    this.stopping = true; this.state = "stopping";
    const c = this.child;
    clearTimeout(this.idleTimer);
    const exited = new Promise<void>((res) => c.once("exit", () => res()));
    try { c.stdin?.end(); } catch { /* gone */ }
    c.kill("SIGTERM");
    await Promise.race([exited, new Promise<void>((res) => setTimeout(res, 5_000))]);
    if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    this.child = undefined; this.state = "stopped";
  }

  /** Send a command and await its `response` (matched by id). */
  request(cmd: Record<string, unknown>, timeoutMs = 120_000): Promise<RpcEvent> {
    const child = this.child;
    if (!child || !child.stdin?.writable) return Promise.reject(new Error("rpc child is not running"));
    const id = `b${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`rpc ${String(cmd.type)} timed out after ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, ...cmd });
      this.touch();
    });
  }
  send(obj: unknown): void { try { if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify(obj) + "\n"); } catch { /* child gone */ } }

  // ---- the commands a bridge needs
  prompt(message: string, streamingBehavior?: "steer" | "followUp") { return this.request({ type: "prompt", message, ...(streamingBehavior ? { streamingBehavior } : {}) }); }
  steer(message: string) { return this.request({ type: "steer", message }); }
  followUp(message: string) { return this.request({ type: "follow_up", message }); }
  abort() { return this.request({ type: "abort" }); }
  newSession() { return this.request({ type: "new_session" }); }
  getState() { return this.request({ type: "get_state" }); }
  getSessionStats() { return this.request({ type: "get_session_stats" }); }
  getLastAssistantText() { return this.request({ type: "get_last_assistant_text" }); }
  setModel(provider: string, modelId: string) { return this.request({ type: "set_model", provider, modelId }); }
  getAvailableModels() { return this.request({ type: "get_available_models" }); }
  respondUi(id: string, r: UiResponse) { this.send({ type: "extension_ui_response", id, ...r }); }

  private onData(text: string): void {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      let line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line) continue;
      let ev: RpcEvent;
      try { ev = JSON.parse(line); } catch { this.opts.onStderr?.(`[rpc] non-JSON on stdout: ${line.slice(0, 120)}\n`); continue; }
      this.dispatch(ev);
    }
  }
  private dispatch(ev: RpcEvent): void {
    this.touch();
    if (ev.type === "response" && typeof ev.id === "string" && this.pending.has(ev.id)) {
      const p = this.pending.get(ev.id)!; this.pending.delete(ev.id); clearTimeout(p.timer);
      if (ev.success === false) p.reject(new Error(String(ev.error ?? `${String(ev.command)} failed`))); else p.resolve(ev);
      return;
    }
    if (ev.type === "extension_ui_request") {
      const req = ev as unknown as UiRequest;
      const dialog = req.method === "select" || req.method === "confirm" || req.method === "input" || req.method === "editor";
      if (dialog) {
        // No answer (adapter TTL expired, no handler) must reach the child as `cancelled`: the gate has no timeout of
        // its own, so silence left the agent frozen inside the tool call forever — steering could never reach it.
        (this.opts.onUiRequest?.(req) ?? Promise.resolve(undefined)).then((r) => this.respondUi(req.id, r ?? { cancelled: true }), () => this.respondUi(req.id, { cancelled: true }));
      }
    }
    this.opts.onEvent?.(ev);
  }
  private onChildExit(code: number | null): void {
    const unexpected = !this.stopping;
    this.failAll(new Error(`rpc child exited (${code})`));
    this.child = undefined; this.state = "stopped";
    clearTimeout(this.idleTimer);
    this.opts.onExit?.(code, unexpected);
    if (unexpected && this.restarts < (this.opts.maxRestarts ?? 3)) {
      const delay = 1000 * 2 ** this.restarts++;
      setTimeout(() => { this.start().catch(() => { /* reported via onExit next time */ }); }, delay).unref();
    }
  }
  private failAll(e: Error): void { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(e); } this.pending.clear(); }
  private touch(): void {
    if (!this.opts.idleMs) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (this.pending.size === 0) void this.stop(); }, this.opts.idleMs);
    this.idleTimer.unref();
  }
}
