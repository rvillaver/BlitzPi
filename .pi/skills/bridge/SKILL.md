---
name: bridge
description: Connect this project to a chat platform (Discord today; Telegram and Slack later) through the BlitzPi bridge — set up the bot once, bind this project's channel, test it. Use when the user asks to "connect this project to Discord", "set up the bot", "bind a channel", or asks why the bot does not answer.
---

# BlitzPi chat bridge — connect this project to a channel

The bridge is a daemon on this machine (`blitzpi bridge start`) that runs one governed BlitzPi session per bound
channel. Humans talk freely in the channel; the bot acts when mentioned (`@blitzpi …`), streams its work into a thread,
asks with buttons, and posts `✅ done`. Everything below goes through **`/blitz-bridge`** commands — never edit
`~/.blitz/bridge/bindings.json` or the token file by hand.

## Procedure
1. **Where are we?** — `/blitz-bridge status`. It says whether the daemon runs, which platforms are live, and whether
   *this* project is bound. Read it before proposing anything.
2. **No Discord token yet** → walk the user through the portal once (they do it in a browser; you only explain):
   https://discord.com/developers/applications → *New Application* → *Bot* → *Reset Token* (copy it) → *Privileged
   Gateway Intents* → **Message Content Intent** on → *OAuth2 → URL Generator*: scopes `bot` + `applications.commands`,
   permissions *Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Embed Links,
   Attach Files, Use Slash Commands* (+ *Manage Channels* if the bot may create channels) → open the URL, pick the
   server. Then `/blitz-bridge setup discord` — it asks for the token privately (never paste it into the chat) and
   stores it at `~/.blitz/bridge/discord.token` (0600).
3. **Daemon not running** → `/blitz-bridge start` (detached; log at `~/.blitz/bridge/daemon.log`). `stop` ends it.
4. **Bind this project** → `/blitz-bridge bind #channel-name` (default: a channel named after the project folder;
   it is created when the bot may). The server owner becomes the operator; add people with
   `/blitz-bridge operators add <user id>`. Settings: `trigger mentions|all|operators`, `activity full|tools|quiet`,
   `context <n>`.
5. **Prove it** → `/blitz-bridge post "hello from <project>"` must appear in the channel; then ask the user to mention
   the bot once (`@blitzpi what is this project?`) and confirm a thread opened with the answer. Report what you observed —
   not what should have happened.

## When the bot does not answer
`/blitz-bridge status` first. Common causes: daemon not running; channel not bound (`/blitz-bridge bind`); the user is
not an operator (`operators add`); `trigger` is `operators`/`mentions` and the message did not mention the bot; the
Message Content intent is off in the portal (the bot sees mentions but no text).
