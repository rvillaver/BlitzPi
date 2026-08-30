/** The bridge's one local control surface: a unix socket (0600) speaking one JSON object per line. */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { bridgeDir } from "./bindings";

export const defaultSocketPath = () => path.join(bridgeDir(), "bridge.sock");
export type OpHandler = (name: string, payload: Record<string, unknown>) => Promise<unknown>;

export function serveSocket(socketPath: string, handle: OpHandler): net.Server {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(socketPath); } catch { /* none */ }
  const server = net.createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let req: { id?: unknown; op?: string } & Record<string, unknown>;
        try { req = JSON.parse(line); } catch { sock.write(JSON.stringify({ ok: false, error: "bad json" }) + "\n"); continue; }
        const { id, op, ...payload } = req;
        handle(String(op ?? ""), payload).then((result) => sock.write(JSON.stringify({ id, ok: true, result }) + "\n"), (e) => sock.write(JSON.stringify({ id, ok: false, error: e instanceof Error ? e.message : String(e) }) + "\n"));
      }
    });
    sock.on("error", () => { /* client gone */ });
  });
  server.listen(socketPath, () => { try { fs.chmodSync(socketPath, 0o600); } catch { /* best effort */ } });
  return server;
}

export function bridgeCall(socketPath: string, op: string, payload: Record<string, unknown> = {}, timeoutMs = 600_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath);
    let buf = ""; const timer = setTimeout(() => { sock.destroy(); reject(new Error(`bridge ${op} timed out`)); }, timeoutMs);
    sock.on("connect", () => sock.write(JSON.stringify({ id: 1, op, ...payload }) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8"); const i = buf.indexOf("\n"); if (i < 0) return;
      clearTimeout(timer); sock.end();
      try { const r = JSON.parse(buf.slice(0, i)); r.ok ? resolve(r.result) : reject(new Error(String(r.error))); } catch (e) { reject(e as Error); }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(new Error(`bridge not reachable at ${socketPath} (${e.message}) — is \`blitzpi bridge start\` running?`)); });
  });
}
