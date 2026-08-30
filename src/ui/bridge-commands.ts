/**
 * `/blitz-bridge …` — set up and bind the chat bridge from inside a session (CHAT-BRIDGE "Registering a conversation").
 * Deterministic mechanics; the `bridge` skill supplies the conversation around them. Same functions as `blitzpi bridge …`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../launcher";
import { BindingsStore, bridgeDir } from "../bridge/bindings";
import { bridgeCall, defaultSocketPath } from "../bridge/socket";
import { show } from "./blitzpi-branding";

const HELP = `/blitz-bridge status                      daemon, platforms, this project's binding
/blitz-bridge setup discord               store the bot token (asked privately) + the portal checklist
/blitz-bridge start | stop | restart      the daemon (detached; log ~/.blitz/bridge/daemon.log)
/blitz-bridge bind [#channel] [dir]       bind this project (default: a channel named after the folder)
/blitz-bridge unbind | post <text> | run <prompt>
/blitz-bridge trigger mentions|all|operators · activity full|tools|quiet · threads on|answer|off · context <n> · operators add|remove <user id>`;

async function daemonUp(sock: string): Promise<boolean> { try { await bridgeCall(sock, "projects", {}, 3000); return true; } catch { return false; } }

export function setupBridgeCommands(pi: ExtensionAPI): void {
  pi.registerCommand("blitz-bridge", {
    description: "Chat bridge: status · setup discord · start/stop · bind [#channel] [dir] · unbind · post · run · trigger · activity · context · operators",
    handler: async (args: string, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const sock = process.env.BLITZ_BRIDGE_SOCKET || defaultSocketPath();
      const project = process.cwd(); const store = new BindingsStore();
      const out = (t: string) => show(pi, ctx, t);
      try {
        if (!sub || sub === "help") return out(HELP);
        if (sub === "status") {
          const up = await daemonUp(sock);
          const mine = store.byProject(project);
          const tokens = ["discord"].filter((p) => fs.existsSync(path.join(bridgeDir(), `${p}.token`)));
          const lines = [`Bridge daemon: ${up ? "running" : "not running"} (${sock})`, `Tokens: ${tokens.length ? tokens.join(", ") : "none — /blitz-bridge setup discord"}`,
            mine ? `This project: bound to ${mine.conv.platform}:${mine.conv.id} (trigger ${mine.binding.trigger}, activity ${mine.binding.activity}, context ${mine.binding.context_window}, operators ${mine.binding.operators.join(", ") || "everyone"})` : "This project: not bound — /blitz-bridge bind [#channel]",
            `All bindings: ${store.list().map((e) => `${e.conv.platform}:${e.conv.id} → ${e.binding.project}`).join("; ") || "none"}`];
          return out(lines.join("\n"));
        }
        if (sub === "setup") {
          const platform = rest[0] ?? "discord";
          if (platform !== "discord") return out("Only discord is available in this version (Telegram and Slack follow).");
          if (!ctx.hasUI) return out("Run this in an interactive session (the token is asked privately), or put it in ~/.blitz/bridge/discord.token (0600).");
          out("Portal checklist: discord.com/developers → New Application → Bot → Reset Token · Message Content Intent ON · OAuth2 URL Generator: bot + applications.commands, permissions Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Embed Links, Attach Files, Use Slash Commands (+ Manage Channels to let bind create channels) → invite to your server.");
          const token = ((await ctx.ui.input("Paste the Discord bot token (stored at ~/.blitz/bridge/discord.token, never shown again)", "")) ?? "").trim();
          if (!token) return out("No token entered — nothing changed.");
          fs.mkdirSync(bridgeDir(), { recursive: true, mode: 0o700 });
          const file = path.join(bridgeDir(), "discord.token"); fs.writeFileSync(file, token, { mode: 0o600 }); fs.chmodSync(file, 0o600);
          const start = await ctx.ui.select("Token stored. Start the bridge daemon now?", ["Yes — start it", "No"]);
          if (start?.startsWith("Yes")) return startDaemon(out);
          return out("Stored. Start with /blitz-bridge start, then /blitz-bridge bind.");
        }
        if (sub === "start") return startDaemon(out);
        if (sub === "restart") { const pidFile = path.join(bridgeDir(), "daemon.pid"); try { const pid = Number(fs.readFileSync(pidFile, "utf8")); process.kill(pid, "SIGTERM"); await new Promise((r) => setTimeout(r, 1500)); } catch { /* none running */ } try { fs.unlinkSync(pidFile); } catch { /* fine */ } return startDaemon(out); }
        if (sub === "stop") {
          const pidFile = path.join(bridgeDir(), "daemon.pid");
          try { const pid = Number(fs.readFileSync(pidFile, "utf8")); process.kill(pid, "SIGTERM"); return out(`Stopped the daemon (pid ${pid}).`); } catch { return out("No running daemon found (no pid file)."); }
        }
        if (!(await daemonUp(sock))) return out("The bridge daemon is not running — /blitz-bridge start first.");
        const mine = store.byProject(project); const conv = mine ? `${mine.conv.platform}:${mine.conv.id}` : undefined;
        if (sub === "bind") {
          const channel = (rest.find((r) => r.startsWith("#")) ?? `#${path.basename(project).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`);
          const dir = rest.find((r) => !r.startsWith("#")) ?? project;
          const r = (await bridgeCall(sock, "bind", { platform: "discord", channel, project: path.resolve(dir), create: true })) as Record<string, unknown>;
          return out(`Bound ${r.conv}${r.created ? " (channel created)" : ""} → ${r.project}\n  trigger ${r.trigger} · activity ${r.activity} · context ${r.context_window} · operators ${(r.operators as string[]).join(", ") || "everyone"}\nMention the bot in that channel to start; /blitz-bridge post "hello" to test.`);
        }
        if (!conv) return out("This project is not bound — /blitz-bridge bind [#channel] first.");
        if (sub === "unbind") { await bridgeCall(sock, "unbind", { conv }); return out(`Unbound ${conv}.`); }
        if (sub === "post") { await bridgeCall(sock, "post", { conv, text: rest.join(" ") }); return out("Posted."); }
        if (sub === "run") { const r = await bridgeCall(sock, "run", { conv, prompt: rest.join(" "), caller: `session:${process.env.USER ?? "user"}` }); return out(`Run: ${JSON.stringify(r)}`); }
        if (sub === "trigger" || sub === "activity" || sub === "threads") { await bridgeCall(sock, "settings", { conv, [sub]: rest[0] }); return out(`${sub} → ${rest[0]}`); }
        if (sub === "context") { await bridgeCall(sock, "settings", { conv, context_window: Number(rest[0] ?? 5) }); return out(`context window → ${rest[0] ?? 5}`); }
        if (sub === "operators") { await bridgeCall(sock, "settings", { conv, [rest[0] === "remove" ? "remove_operator" : "add_operator"]: rest[1] }); return out(`operators: ${rest[0]} ${rest[1]}`); }
        return out(HELP);
      } catch (e) { return out(`⚠️ ${e instanceof Error ? e.message : e}`); }
    },
  });
}

function startDaemon(out: (t: string) => void): void {
  const log = path.join(bridgeDir(), "daemon.log");
  fs.mkdirSync(bridgeDir(), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(log, "a");
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "bin", "blitzpi.ts"), "bridge", "start"], { detached: true, stdio: ["ignore", fd, fd], env: { ...process.env } });
  child.unref();
  out(`Bridge daemon starting (pid ${child.pid}); log: ${log}. /blitz-bridge status in a few seconds.`);
}
