/**
 * `blitzpi bridge …` — the shell face of the bridge. `run` drives a project in-process and renders to the terminal;
 * `start` is the daemon (socket + adapters); everything else talks to the daemon over the socket.
 */
import os from "node:os";
import path from "node:path";
import { Bridge } from "./core";
import { BindingsStore } from "./bindings";
import { ConsoleAdapter } from "./console-adapter";
import { DiscordAdapter, discordToken } from "./discord-adapter";
import { bridgeCall, defaultSocketPath, serveSocket } from "./socket";
import type { Binding, ConvRef } from "./types";

const USAGE = `Usage: blitzpi bridge <command>
  run [--project DIR] "<prompt>"       run one request against a project here, in this terminal
  start | shutdown | restart            the daemon: control socket + platform adapters (start is foreground)
  post [--project DIR|--conv P:ID] "<text>"    post into the bound conversation
  ask  [--project DIR|--conv P:ID] "<question>" [option…]   ask and print the answer
  stop | status [--project DIR|--conv P:ID]      stop = abort the conversation's current run
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
    // A channel *name* needs the platform to resolve it: go through the running daemon when there is one.
    if (!/^\d+$/.test(conv.id) && conv.platform !== "console") {
      try {
        const r = (await bridgeCall(socketPath, "bind", { platform: conv.platform, channel: conv.id, project: dir, create: f["no-create"] !== "true", ...partial })) as Binding & { conv: string; created: boolean };
        console.log(`bound ${r.conv}${r.created ? " (channel created)" : ""} → ${r.project} (trigger ${r.trigger}, activity ${r.activity}, context ${r.context_window}, operators ${r.operators.length ? r.operators.join(", ") : "everyone"})`); return;
      } catch (e) { console.error(`[bridge] ${e instanceof Error ? e.message : e}\n  (a channel name needs the daemon running: blitzpi bridge start — or bind by numeric id)`); process.exitCode = 1; return; }
    }
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

  if (sub === "shutdown" || sub === "restart") {
    const pidFile = path.join(path.dirname(socketPath), "daemon.pid");
    let pid = 0; try { pid = Number(require("node:fs").readFileSync(pidFile, "utf8")); } catch { /* none */ }
    if (pid) { try { process.kill(pid, "SIGTERM"); } catch { pid = 0; } }
    if (pid) { for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 100)); } catch { break; } } console.log(`daemon ${pid} stopped`); } else console.log("no daemon was running");
    try { require("node:fs").unlinkSync(pidFile); } catch { /* fine */ }
    if (sub === "shutdown") return;
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const log = path.join(path.dirname(socketPath), "daemon.log");
    const fd = require("node:fs").openSync(log, "a");
    const child = spawn(process.execPath, [path.join(__dirname, "..", "..", "bin", "blitzpi.ts"), "bridge", "start"], { detached: true, stdio: ["ignore", fd, fd], env: { ...process.env } });
    child.unref();
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); try { await bridgeCall(socketPath, "projects", {}, 2000); console.log(`daemon restarted (pid ${child.pid}); log: ${log}`); return; } catch { /* not yet */ } }
    console.error("daemon did not come up within 30 s — see " + log); process.exitCode = 1; return;
  }
  if (sub === "start") {
    const log = (l: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${l}\n`);
    // One daemon per machine: a second gateway connection on the same bot token would answer every interaction twice.
    const pidFileEarly = path.join(path.dirname(socketPath), "daemon.pid");
    try { const pid = Number(require("node:fs").readFileSync(pidFileEarly, "utf8")); if (pid && pid !== process.pid) { process.kill(pid, 0); console.error(`[bridge] a daemon is already running (pid ${pid}) — blitzpi bridge restart picks up new code; blitzpi bridge shutdown stops it (blitzpi bridge stop only aborts a run)`); process.exitCode = 1; return; } } catch { /* stale or absent */ }
    const bridge = new Bridge({ bindings: store, socketPath, log });
    bridge.attach(new ConsoleAdapter(log, false));
    const platforms = ["console"];
    const token = discordToken();
    if (token) {
      const discord: DiscordAdapter = new DiscordAdapter({
        token, log,
        onSlash: async ({ sub: cmd, options, conv, user, guildOwnerId }) => {
          const key = `${conv.platform}:${conv.id}`;
          const b = store.get(conv);
          const operator = b ? (b.operators.length ? b.operators.includes(user.id) : user.id === guildOwnerId) : user.id === guildOwnerId;
          if (cmd === "status") return b ? String(((await bridge.op("status", { conv: key })) as { text: string }).text) : "This channel is not bound to a project — `/blitz bind <dir>` (owner) binds it.";
          if (!operator) return "Only operators can do that here.";
          if (cmd === "bind") { const r = (await bridge.op("bind", { platform: conv.platform, channel: conv.id, project: String(options.project), operators: b?.operators?.length ? b.operators : [guildOwnerId ?? user.id] })) as Binding; return `Bound to \`${r.project}\` — trigger ${r.trigger}, activity ${r.activity}, context ${r.context_window}. Mention me to start.`; }
          if (!b) return "This channel is not bound — `/blitz bind <dir>` first.";
          if (cmd === "unbind") { await bridge.op("unbind", { conv: key }); return "Unbound."; }
          if (cmd === "stop") { await bridge.op("stop", { conv: key }); return "⏹ stop requested."; }
          if (cmd === "new") { await bridge.op("new", { conv: key }); return "🆕 next request starts a fresh session."; }
          if (cmd === "trigger") { await bridge.op("settings", { conv: key, trigger: options.mode }); return `Trigger: **${options.mode}**.`; }
          if (cmd === "activity") { await bridge.op("settings", { conv: key, activity: options.level }); return `Activity: **${options.level}**.`; }
          if (cmd === "threads") { await bridge.op("settings", { conv: key, threads: options.mode }); return `Threads: **${options.mode}** — ${options.mode === "on" ? "activity and answers in the shared thread" : options.mode === "answer" ? "activity in the shared thread, answers here" : "everything here"}.`; }
          if (cmd === "context") { await bridge.op("settings", { conv: key, context_window: Number(options.messages) }); return `Context window: **${options.messages}** message(s).`; }
          if (cmd === "operators") { await bridge.op("settings", { conv: key, [options.action === "add" ? "add_operator" : "remove_operator"]: String(options.user) }); return `Operator ${options.action === "add" ? "added" : "removed"}: <@${options.user}>.`; }
          return "Unknown command.";
        },
      });
      bridge.attach(discord);
      try { await discord.start(); platforms.push("discord"); } catch (e) { log(`[discord] could not start: ${e instanceof Error ? e.message : e}`); }
    }
    const server = serveSocket(socketPath, (op, payload) => bridge.op(op, payload));
    const pidFile = path.join(path.dirname(socketPath), "daemon.pid");
    try { require("node:fs").writeFileSync(pidFile, String(process.pid)); } catch { /* fine */ }
    process.on("exit", () => { try { require("node:fs").unlinkSync(pidFile); } catch { /* fine */ } });
    log(`[bridge] control socket ${socketPath}`);
    log(`[bridge] platforms: ${platforms.join(", ")}${token ? "" : " (no Discord token at ~/.blitz/bridge/discord.token)"}`);
    log(`[bridge] bound: ${store.list().length} conversation(s) — blitzpi bridge projects`);
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
