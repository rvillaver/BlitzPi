---
name: bridge
description: Connect this project to a chat platform (Discord today; Telegram and Slack later) through the BlitzPi bridge — set up the bot once, bind this project's channel, test it. Use when the user asks to "connect this project to Discord", "set up the bot", "bind a channel", or asks why the bot does not answer.
---

# BlitzPi chat bridge — connect this project to a channel

The bridge is a daemon on this machine (`blitzpi bridge start`) that runs one governed BlitzPi session per bound
channel. Humans talk freely in the channel; the bot acts when mentioned (`@blitzpi …`), streams its work into a thread,
asks with buttons, and posts `✅ done`. Never edit `~/.blitz/bridge/bindings.json` or the token file by hand.

**You (the agent) run `blitzpi bridge <subcommand>` via your bash tool — not `/blitz-bridge`.** `/blitz-bridge …` is a
Pi slash command: it only runs from something a human types into the prompt (or an RPC `prompt` call), never from a
tool call, so you have no way to invoke it yourself. `blitzpi bridge status|start|stop|bind|unbind|post|ask|new` are
real CLI subcommands with the exact same behavior — run those. The one exception is `setup discord` (step 2 below):
it has no CLI form at all, on purpose — it prompts privately for the bot token, and that prompt only exists inside an
interactive session. For that one step, tell the user to type `/blitz-bridge setup discord` themselves and wait for
them to confirm it's done; do not try to invoke it yourself, guess at the token, or ask them to paste it into the chat.

## Procedure
1. **Where are we?** — `blitzpi bridge status`. It says whether the daemon runs, which platforms are live, and whether
   *this* project is bound. Read it before proposing anything.
2. **No Discord token yet** → walk the user through the portal once (they do it in a browser; you only explain):
   https://discord.com/developers/applications → *New Application* → *Bot* → *Reset Token* (copy it) → *Privileged
   Gateway Intents* → **Message Content Intent** on → *OAuth2 → URL Generator*: scopes `bot` + `applications.commands`,
   permissions *Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Embed Links,
   Attach Files, Use Slash Commands* (+ *Manage Channels* if the bot may create channels) → open the URL, pick the
   server. Then ask the user to run **`/blitz-bridge setup discord`** themselves (private token prompt; you cannot run
   this step) — it stores the token at `~/.blitz/bridge/discord.token` (0600). Confirm with `blitzpi bridge status`
   before moving on.
3. **Daemon not running** → `blitzpi bridge start` (detached; log at `~/.blitz/bridge/daemon.log`). `stop` ends it.
4. **Bind this project** → `blitzpi bridge bind <platform:id-or-name> [dir]` (default: a channel named after the
   project folder; it is created when the bot may). The server owner becomes the operator; add people with
   `blitzpi bridge bind ... --operator <user id>` (repeatable). Settings: `--trigger mentions|all|operators`,
   `--activity full|tools|quiet`, `--context <n>`.
5. **Prove it** → `blitzpi bridge post "hello from <project>"` must appear in the channel; then ask the user to mention
   the bot once (`@blitzpi what is this project?`) and confirm a thread opened with the answer. Report what you observed —
   not what should have happened.

## When the bot does not answer
`blitzpi bridge status` first. Common causes: daemon not running; channel not bound (`blitzpi bridge bind`); the user is
not an operator (`--operator` on bind); `trigger` is `operators`/`mentions` and the message did not mention the bot; the
Message Content intent is off in the portal (the bot sees mentions but no text).
