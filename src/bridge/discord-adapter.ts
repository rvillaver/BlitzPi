/**
 * Discord adapter (CHAT-BRIDGE phase 2). Translates Discord into the bridge's neutral contracts and nothing else:
 * mentions / replies / thread messages → triggers; a run thread per request; append-only posts under 2000 chars;
 * dialog requests → buttons (≤ 5), a select menu (≤ 25) or a modal; `/blitz …` slash commands; the last-N context.
 * Token: ~/.blitz/bridge/discord.token (0600) or BLITZ_DISCORD_TOKEN. One gateway connection per token.
 */
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, Events, GatewayIntentBits, MessageFlags, ModalBuilder, Partials, PermissionsBitField,
  REST, Routes, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type Interaction, type Message as DMessage, type TextChannel, type ThreadChannel,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { bridgeDir } from "./bindings";
import type { UiRequest, UiResponse } from "./rpc-host";
import type { AdapterCapabilities, Attachment, ChatAdapter, ConvRef, Message, ThreadRef, Trigger, UserRef } from "./types";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export function discordToken(): string | undefined {
  if (process.env.BLITZ_DISCORD_TOKEN) return process.env.BLITZ_DISCORD_TOKEN.trim();
  try { return fs.readFileSync(path.join(bridgeDir(), "discord.token"), "utf8").trim() || undefined; } catch { return undefined; }
}

const MAX = 2000;
const QUESTION_TTL_MS = 10 * 60_000;
type Pending = { req: UiRequest; resolve: (r: UiResponse | undefined) => void; canAnswer: (u: UserRef) => boolean; messageId?: string; timer: NodeJS.Timeout };

export interface DiscordAdapterOptions {
  token: string;
  /** Slash-command handlers the daemon provides (bind/unbind/settings/status/stop/new go through the bridge). */
  onSlash?: (cmd: { name: string; sub?: string; options: Record<string, unknown>; conv: ConvRef; user: UserRef; guildOwnerId?: string }) => Promise<string>;
  log?: (line: string) => void;
}

export class DiscordAdapter implements ChatAdapter {
  readonly platform = "discord";
  readonly capabilities: AdapterCapabilities = { threads: true, buttons: 5, selectMenu: 25, modal: true, messageChars: MAX, paceWindowMs: 1500, attachmentBytes: 25 * 1024 * 1024, seesAllMessages: true };
  private client: Client;
  private triggerCb?: (t: Trigger) => void;
  private pending = new Map<string, Pending>();
  private ourThreads = new Set<string>();
  constructor(private opts: DiscordAdapterOptions) {
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel, Partials.Message] });
    this.client.on("error", (e) => this.opts.log?.(`[discord] client error: ${e.message}`));
    this.client.on(Events.MessageCreate, (m) => { this.onMessage(m).catch((e) => this.opts.log?.(`[discord] message handler: ${e instanceof Error ? e.message : e}`)); });
    this.client.on(Events.InteractionCreate, (i) => { this.onInteraction(i).catch((e) => this.opts.log?.(`[discord] interaction handler: ${e instanceof Error ? e.message : e}`)); });
  }
  get user() { return this.client.user; }

  async start(): Promise<void> {
    await this.client.login(this.opts.token);
    await new Promise<void>((r) => (this.client.isReady() ? r() : this.client.once(Events.ClientReady, () => r())));
    await this.registerSlash();
    this.opts.log?.(`[discord] ready as ${this.client.user?.tag} in ${this.client.guilds.cache.size} guild(s): ${[...this.client.guilds.cache.values()].map((g) => g.name).join(", ")}`);
  }
  async stop(): Promise<void> { for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve(undefined); } this.pending.clear(); await this.client.destroy(); }
  onTrigger(cb: (t: Trigger) => void): void { this.triggerCb = cb; }
  identity(u: UserRef): string { return `discord:${u.id}${u.name ? `#${u.name}` : ""}`; }
  threadLink(t: ThreadRef): string { return `<#${t.id}>`; }

  // ---- slash commands -------------------------------------------------------------------------------------------
  private async registerSlash(): Promise<void> {
    const cmds = [{
      name: "blitz", description: "BlitzPi in this channel",
      options: [
        { type: 1, name: "status", description: "Session, model, context and settings for this channel" },
        { type: 1, name: "stop", description: "Abort the current run (the session survives)" },
        { type: 1, name: "new", description: "Start a fresh session for this channel" },
        { type: 1, name: "bind", description: "Bind this channel to a project directory on the bridge machine", options: [{ type: 3, name: "project", description: "Absolute project directory", required: true }] },
        { type: 1, name: "unbind", description: "Unbind this channel" },
        { type: 1, name: "trigger", description: "When BlitzPi acts: mentions | all | operators", options: [{ type: 3, name: "mode", description: "mentions | all | operators", required: true, choices: [{ name: "mentions", value: "mentions" }, { name: "all", value: "all" }, { name: "operators", value: "operators" }] }] },
        { type: 1, name: "activity", description: "How much of a run streams into the thread", options: [{ type: 3, name: "level", description: "full | tools | quiet", required: true, choices: [{ name: "full", value: "full" }, { name: "tools", value: "tools" }, { name: "quiet", value: "quiet" }] }] },
        { type: 1, name: "threads", description: "Where runs post: on = all in the thread · answer = answers follow where you ask · off = all here", options: [{ type: 3, name: "mode", description: "on | answer | off", required: true, choices: [{ name: "on", value: "on" }, { name: "answer", value: "answer" }, { name: "off", value: "off" }] }] },
        { type: 1, name: "context", description: "Recent channel messages handed to the agent on mention (0 = off)", options: [{ type: 4, name: "messages", description: "0–20", required: true, min_value: 0, max_value: 20 }] },
        { type: 1, name: "operators", description: "Who may drive BlitzPi here", options: [{ type: 3, name: "action", description: "add | remove", required: true, choices: [{ name: "add", value: "add" }, { name: "remove", value: "remove" }] }, { type: 6, name: "user", description: "The member", required: true }] },
      ],
    }];
    const rest = new REST().setToken(this.opts.token);
    for (const g of this.client.guilds.cache.values()) {
      try { await rest.put(Routes.applicationGuildCommands(this.client.user!.id, g.id), { body: cmds }); } catch (e) { this.opts.log?.(`[discord] slash registration failed in ${g.name}: ${e instanceof Error ? e.message : e}`); }
    }
  }

  // ---- inbound -------------------------------------------------------------------------------------------------
  private convOf(channel: DMessage["channel"]): { conv: ConvRef; thread?: ThreadRef } {
    if (channel.isThread()) { const t = channel as ThreadChannel; const conv = { platform: "discord", id: t.parentId ?? t.id }; return { conv, thread: { platform: "discord", id: t.id, conv } }; }
    return { conv: { platform: "discord", id: channel.id } };
  }
  private async onMessage(m: DMessage): Promise<void> {
    if (m.author.bot || !this.client.user) return;
    if (m.channel.type === ChannelType.DM) return; // DMs are not conversations (phase 2); operators use slash commands
    const me = this.client.user.id;
    const { conv, thread } = this.convOf(m.channel);
    const mentioned = m.mentions.users.has(me) && !m.mentions.everyone;
    let kind: Trigger["kind"] = "message";
    if (mentioned) kind = "mention";
    else if (m.reference?.messageId) { try { const ref = await m.channel.messages.fetch(m.reference.messageId); if (ref.author.id === me) kind = "reply"; } catch { /* gone */ } }
    else if (thread && (this.ourThreads.has(thread.id) || (m.channel as ThreadChannel).ownerId === me)) kind = "thread";
    const text = m.content.replace(new RegExp(`<@!?${me}>`, "g"), "").trim();
    const author: UserRef = { id: m.author.id, name: m.author.username };
    const attachments = [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url, bytes: a.size }));
    if (kind !== "message") { try { await m.react("👀"); } catch { /* fine */ } }
    this.triggerCb?.({ kind, conv, thread, message: { id: m.id, author, text, time: m.createdTimestamp, attachments }, text: text || (attachments.length ? `(attachment: ${attachments.map((a) => a.name).join(", ")})` : "") });
  }
  private async onInteraction(i: Interaction): Promise<void> {
    if (i.isChatInputCommand()) return this.onSlashCommand(i);
    if (!(i.isButton() || i.isStringSelectMenu() || i.isModalSubmit())) return;
    const m = /^q:([^:]+)(?::(.*))?$/.exec(i.customId); if (!m) return;
    const p = this.pending.get(m[1]);
    if (!p) { if (!i.isModalSubmit()) await i.reply({ content: "This question has expired.", flags: MessageFlags.Ephemeral }); else await i.reply({ content: "This question has expired.", flags: MessageFlags.Ephemeral }); return; }
    const user: UserRef = { id: i.user.id, name: i.user.username };
    if (!p.canAnswer(user)) { await i.reply({ content: "Only operators can answer BlitzPi here.", flags: MessageFlags.Ephemeral }); return; }
    let value: UiResponse | undefined;
    if (i.isButton()) {
      const arg = m[2] ?? "";
      if (arg === "other" || p.req.method === "input" || p.req.method === "editor") {
        const modal = new ModalBuilder().setCustomId(`q:${m[1]}:modal`).setTitle((p.req.title ?? "Answer").slice(0, 45));
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("text").setLabel("Your answer").setStyle(p.req.method === "editor" ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(true).setValue((p.req.prefill ?? "").slice(0, 4000))));
        await i.showModal(modal); return; // the modal submit resolves it
      }
      if (p.req.method === "confirm") value = { confirmed: arg === "yes" };
      else value = { value: p.req.options?.[Number(arg)] ?? arg };
      await i.update({ content: `${i.message.content}\n✔ ${user.name}: **${"value" in value ? value.value : value.confirmed ? "Yes" : "No"}**`, components: [] }).catch(() => {});
    } else if (i.isStringSelectMenu()) {
      value = { value: i.values[0] };
      await i.update({ content: `${i.message.content}\n✔ ${user.name}: **${i.values[0]}**`, components: [] }).catch(() => {});
    } else if (i.isModalSubmit()) {
      const text = i.fields.getTextInputValue("text");
      value = { value: text };
      await i.reply({ content: `✔ ${user.name}: ${text.slice(0, 1800)}` }).catch(() => {});
    }
    this.settle(m[1], value);
  }
  private settle(id: string, value: UiResponse | undefined): void { const p = this.pending.get(id); if (!p) return; clearTimeout(p.timer); this.pending.delete(id); p.resolve(value); }
  private async onSlashCommand(i: ChatInputCommandInteraction): Promise<void> {
    if (!i.channel) return;
    const { conv } = this.convOf(i.channel as DMessage["channel"]);
    const sub = i.options.getSubcommand(false) ?? undefined;
    const options: Record<string, unknown> = {};
    for (const o of i.options.data[0]?.options ?? []) options[o.name] = o.type === 6 ? (o.user?.id ?? o.value) : o.value;
    const user: UserRef = { id: i.user.id, name: i.user.username };
    await i.deferReply(sub !== "status" ? { flags: MessageFlags.Ephemeral } : {});
    try {
      const reply = this.opts.onSlash ? await this.opts.onSlash({ name: i.commandName, sub, options, conv, user, guildOwnerId: i.guild?.ownerId }) : "no handler";
      await i.editReply(reply.slice(0, 1900));
    } catch (e) { await i.editReply(`⚠️ ${e instanceof Error ? e.message : e}`); }
  }

  // ---- outbound -------------------------------------------------------------------------------------------------
  private async channel(id: string): Promise<TextChannel | ThreadChannel> {
    const c = await this.client.channels.fetch(id);
    if (!c || !("send" in c)) throw new Error(`channel ${id} is not a text channel the bot can see`);
    return c as TextChannel | ThreadChannel;
  }
  async openThread(conv: ConvRef, name: string, existingId?: string): Promise<ThreadRef> {
    const ch = (await this.channel(conv.id)) as TextChannel;
    let thread: ThreadChannel | undefined;
    if (existingId) { try { const t = await this.client.channels.fetch(existingId); if (t?.isThread()) { thread = t as ThreadChannel; if (thread.archived) await thread.setArchived(false); } } catch { /* deleted → create anew */ } }
    if (!thread) thread = await ch.threads.create({ name: name.slice(0, 100) || "blitzpi", autoArchiveDuration: 10080, reason: "blitzpi bridge work thread" });
    this.ourThreads.add(thread.id);
    return { platform: "discord", id: thread.id, conv };
  }
  async post(target: ConvRef | ThreadRef, text: string, opts?: { replyTo?: string }): Promise<void> {
    const ch = await this.channel(target.id);
    let first = true;
    for (const chunk of chunks(text, MAX)) { await ch.send({ content: chunk, allowedMentions: { parse: [] }, ...(first && opts?.replyTo ? { reply: { messageReference: opts.replyTo, failIfNotExists: false } } : {}) }); first = false; }
  }
  async ask(target: ConvRef | ThreadRef, req: UiRequest, canAnswer: (u: UserRef) => boolean): Promise<UiResponse | undefined> {
    const ch = await this.channel(target.id);
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const title = (req.title ?? req.message ?? "Question").slice(0, 1800);
    const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    const opts = req.options ?? [];
    if (req.method === "confirm") {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`q:${id}:yes`).setLabel("Yes").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`q:${id}:no`).setLabel("No").setStyle(ButtonStyle.Secondary)));
    } else if (req.method === "select" && opts.length && opts.length <= 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(opts.map((o, n) => new ButtonBuilder().setCustomId(`q:${id}:${n}`).setLabel(o.slice(0, 80)).setStyle(n === 0 ? ButtonStyle.Primary : ButtonStyle.Secondary))));
    } else if (req.method === "select" && opts.length) {
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`q:${id}:menu`).setPlaceholder("Choose…").addOptions(opts.slice(0, 25).map((o) => ({ label: o.slice(0, 100), value: o.slice(0, 100) })))));
    } else {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`q:${id}:other`).setLabel("Answer…").setStyle(ButtonStyle.Primary)));
    }
    const body = `❓ ${title}${req.message && req.title ? `\n${req.message.slice(0, 500)}` : ""}${req.placeholder ? `\n_${req.placeholder}_` : ""}`;
    const msg = await ch.send({ content: body, components: rows, allowedMentions: { parse: [] } });
    return new Promise<UiResponse | undefined>((resolve) => {
      const ttl = req.timeout && req.timeout > 0 ? req.timeout : QUESTION_TTL_MS;
      const timer = setTimeout(() => { this.pending.delete(id); resolve(undefined); msg.edit({ content: `${body}\n⏳ no answer`, components: [] }).catch(() => {}); }, ttl);
      this.pending.set(id, { req, resolve, canAnswer, messageId: msg.id, timer });
    });
  }
  async download(file: Attachment, to: string): Promise<string> {
    const res = await fetch(file.url); if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? file.bytes ?? 0); if (len > this.capabilities.attachmentBytes) throw new Error("too large");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(to));
    return to;
  }
  async postFiles(target: ConvRef | ThreadRef, files: { path: string; name: string }[], text?: string): Promise<void> {
    const ch = await this.channel(target.id);
    for (let i = 0; i < files.length; i += 10) await ch.send({ content: i === 0 ? text?.slice(0, 1900) : undefined, files: files.slice(i, i + 10).map((f) => ({ attachment: f.path, name: f.name })), allowedMentions: { parse: [] } });
  }
  async recent(conv: ConvRef, n: number, sinceId?: string): Promise<Message[]> {
    try {
      const ch = await this.channel(conv.id);
      const msgs = await ch.messages.fetch({ limit: Math.min(50, Math.max(1, n * 3)), ...(sinceId ? { after: sinceId } : {}) });
      return [...msgs.values()].filter((m) => !m.author.bot).sort((a, b) => a.createdTimestamp - b.createdTimestamp).slice(-n).map((m) => ({ id: m.id, author: { id: m.author.id, name: m.author.username }, text: m.cleanContent, time: m.createdTimestamp }));
    } catch { return []; }
  }
  async resolveConversation(name: string, create: boolean): Promise<{ conv: ConvRef; created: boolean; owner?: UserRef } | undefined> {
    const guild = this.client.guilds.cache.first(); if (!guild) return undefined;
    const want = name.replace(/^#/, "").toLowerCase();
    const chans = await guild.channels.fetch();
    const found = [...chans.values()].find((c) => c?.type === ChannelType.GuildText && c.name.toLowerCase() === want);
    const owner = await guild.fetchOwner().then((o) => ({ id: o.id, name: o.user.username })).catch(() => undefined);
    if (found) return { conv: { platform: "discord", id: found.id }, created: false, owner };
    if (!create) return undefined;
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionsBitField.Flags.ManageChannels)) return undefined;
    const c = await guild.channels.create({ name: want.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "blitzpi", reason: "blitzpi bridge bind" });
    return { conv: { platform: "discord", id: c.id }, created: true, owner };
  }
}

function chunks(text: string, max: number): string[] {
  const out: string[] = []; let s = text;
  while (s.length > max) { let cut = s.lastIndexOf("\n", max); if (cut < max * 0.5) cut = max; out.push(s.slice(0, cut)); s = s.slice(cut); }
  if (s.length || !out.length) out.push(s || "(empty)");
  return out;
}
