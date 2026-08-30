/**
 * `blitzpi bridge …` — the shell face of the bridge. `run` drives a project in-process and renders to the terminal;
 * `start` is the daemon (socket + adapters); everything else talks to the daemon over the socket.
 */
import os from "node:os";
import path from "node:path";
import { Bridge } from "./core";
import { BindingsStore } from "./bindings";
import { ConsoleAdapter } from "./console-adapter";
import { bridgeCall, defaultSocketPath, serveSocket } from "./socket";
import type { Binding, ConvRef } from "./types";

const USAGE = `Usage: blitzpi bridge <command>
  run [--project DIR] "<prompt>"       run one request against a project here, in this terminal
  start                                 the daemon: control socket + platform adapters (foreground)
  post [--project DIR|--conv P:ID] "<text>"    post into the bound conversation
  ask  [--project DIR|--conv P:ID] "<question>" [option…]   ask and print the answer
  stop | status [--project DIR|--conv P:ID]
  projects                              bound conversations
  bind <platform:id> [DIR] [--trigger mentions|all|operators] [--activity full|tools|quiet] [--context N] [--operator ID…]
  unbind <platform:id>`;

function parseConv(s: string): ConvRef { const i = s.indexOf(":"); if (i <= 0) throw new Error(`expected <platform>:<id>, got ${s}`); return { platform: s.slice(0, i), id: s.slice(i + 1) }; }
function flags(args: string[]): { rest: string[]; f: Record<string, string | string[]> } {
  const rest: string[] = []; const f: Record<string, string | string[]> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true"; if (k === "operator") f[k] = [...((f[k] as string[]) ?? []), v]; else f[k] = v; }
    else rest.push(a);
  }
  return { rest, f };
}

export async function handleBridgeCommand(args: string[]): Promise<void> {
  const sub = args[0]; const { rest, f } = flags(args.slice(1));
  const store = new BindingsStore(); const socketPath = process.env.BLITZ_BRIDGE_SOCKET || defaultSocketPath();
  const sel = () => (f.conv ? { conv: String(f.conv) } : { project: String(f.project ?? process.cwd()) });
  if (!sub || sub === "--help" || sub === "-h") { console.log(USAGE); return; }

  if (sub === "bind") {
    const conv = parseConv(rest[0] ?? ""); const dir = path.resolve(rest[1] ?? process.cwd());
    const partial: Partial<Binding> = {};
    if (f.trigger) partial.trigger = f.trigger as Binding["trigger"]; if (f.activity) partial.activity = f.activity as Binding["activity"];
    if (f.context) partial.context_window = Number(f.context); if (f.operator) partial.operators = f.operator as string[];
    const b = store.bind(conv, dir, partial);
    console.log(`bound ${rest[0]} → ${b.project} (trigger ${b.trigger}, activity ${b.activity}, context ${b.context_window}, operators ${b.operators.length ? b.operators.join(", ") : "everyone"})`); return;
  }
  if (sub === "unbind") { console.log(store.unbind(parseConv(rest[0] ?? "")) ? `unbound ${rest[0]}` : `nothing bound as ${rest[0]}`); return; }
  if (sub === "projects") {
    const list = store.list(); if (!list.length) { console.log("no conversations bound — blitzpi bridge bind <platform:id> <dir>"); return; }
    for (const e of list) console.log(`  ${e.conv.platform}:${e.conv.id}  →  ${e.binding.project}  (${e.binding.trigger}, ${e.binding.activity}${e.binding.sessionId ? `, session ${e.binding.sessionId.slice(0, 8)}…` : ""})`);
    return;
  }

  if (sub === "run") {
    const prompt = rest.join(" ").trim(); if (!prompt) { console.log(USAGE); process.exitCode = 2; return; }
    const project = path.resolve(String(f.project ?? process.cwd()));
    const conv: ConvRef = { platform: "console", id: path.basename(project) };
    const tmpStore = new BindingsStore(path.join(os.tmpdir(), `blitz-bridge-run-${process.pid}.json`));
    tmpStore.bind(conv, project, { context_window: 0, announce_done: false });
    const adapter = new ConsoleAdapter();
    const bridge = new Bridge({ bindings: tmpStore, log: (l) => process.stderr.write(l + "\n") });
    bridge.attach(adapter);
    await bridge.op("run", { conv: `${conv.platform}:${conv.id}`, prompt, caller: `shell:${os.userInfo().username}` });
    await bridge.waitIdle(conv, 30 * 60_000);
    await bridge.stop();
    try { require("node:fs").unlinkSync(tmpStore.file); } catch { /* fine */ }
    return;
  }

  if (sub === "start") {
    const adapter = new ConsoleAdapter((l) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${l}\n`), false);
    const bridge = new Bridge({ bindings: store, socketPath, log: (l) => process.stderr.write(l + "\n") });
    bridge.attach(adapter);
    const server = serveSocket(socketPath, (op, payload) => bridge.op(op, payload));
    console.log(`[bridge] control socket ${socketPath}\n[bridge] platforms: console (Discord/Telegram/Slack adapters arrive in phase 2)\n[bridge] bound: ${store.list().length} conversation(s) — blitzpi bridge projects`);
    await new Promise<void>((res) => { const bye = () => { server.close(); bridge.stop().finally(() => res()); }; process.on("SIGINT", bye); process.on("SIGTERM", bye); });
    return;
  }

  // socket clients
  try {
    if (sub === "post") { await bridgeCall(socketPath, "post", { ...sel(), text: rest.join(" ") }); console.log("posted"); return; }
    if (sub === "ask") { const r = (await bridgeCall(socketPath, "ask", { ...sel(), question: rest[0] ?? "", options: rest.slice(1) })) as { answer: string | null }; if (r.answer == null) { process.exitCode = 1; return; } console.log(r.answer); return; }
    if (sub === "stop") { await bridgeCall(socketPath, "stop", sel()); console.log("stopped"); return; }
    if (sub === "status") { const r = (await bridgeCall(socketPath, "status", sel())) as { text: string }; console.log(r.text); return; }
  } catch (e) { console.error(`[bridge] ${e instanceof Error ? e.message : e}`); process.exitCode = 1; return; }
  console.log(USAGE); process.exitCode = 2;
}
