# The chat bridge

Run BlitzPi from a chat platform: mention it in a channel, it works in a project on your machine and replies
there. The agent still runs locally, under the same sandbox, governance and audit as a terminal session — chat is
an input surface, not a new set of permissions.

Today: **Discord**. Telegram and Slack are planned.

---

## The trust model — read this before you connect anything

**Anyone who can make the bot work in a conversation can make your agent do things on your machine**, inside the
usual guardrails. So access is deliberately narrow:

| | |
|---|---|
| **Operators only** | Only user IDs listed as operators for a conversation can ask BlitzPi to do work, or use control words (`stop`, `new`, `status`). Everyone else is refused, by name, in the channel. |
| **Bound conversations only** | A conversation does nothing until it is explicitly bound to a project directory. Unbound conversations reply once to say they are unbound. |
| **One project per conversation** | A conversation reaches exactly the project it is bound to. Two conversations get two independent agents, each confined to its own project. Binding a project that another conversation already holds is **refused** unless you pass `--force` — two agents on one directory write the same files with no coordination between them. |
| **The sandbox still applies** | Shell commands run confined to the bound project, file writes are gated, dangerous commands still ask. Chat does not bypass any of it. |
| **Permission questions go to chat** | When the agent needs a decision, the question appears in the conversation and only an operator can answer it. |
| **It runs as you** | The daemon runs as your user, with your credentials. Do not run it as root or as a shared system service. |

**Unbinding is how you revoke access**, and it takes effect immediately — the conversation detaches and its agent
process is stopped. (Before 2026-09-05 an unbound conversation kept answering until the daemon restarted; fixed.)

Anything you would not let a channel member run on your laptop, do not bind to a channel they can post in.

---

## Setting up on a new machine

### 1. Create the Discord application

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** → **Add Bot**. Copy the token — this is a password; treat it like one.
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**. Without it the bot cannot read the
   text of messages and will look like it is ignoring you.
4. **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`; permissions **Send Messages**,
   **Read Message History**, **Create Public Threads**, **Send Messages in Threads**. Open the generated URL and
   invite the bot to your server.

### 2. Give BlitzPi the token

```
mkdir -p ~/.blitz/bridge
printf '%s' 'YOUR_TOKEN' > ~/.blitz/bridge/discord.token
chmod 600 ~/.blitz/bridge/discord.token
```

Tokens live only here. They are never written into the service unit, the bindings file, or the audit trail.

### 3. Bind a conversation to a project

Find your own Discord user ID (User Settings → Advanced → Developer Mode, then right-click yourself → Copy User ID)
and the channel ID (right-click the channel → Copy Channel ID).

```
blitzpi bridge bind discord:CHANNEL_ID /path/to/project --operator YOUR_USER_ID
```

### 4. Start it

```
blitzpi bridge start          # foreground, for a first look
blitzpi bridge install-service   # or: run it under systemd/launchd so it survives a reboot
```

`install-service` writes a **user** unit (`~/.config/systemd/user/blitzpi-bridge.service`) or a LaunchAgent
(`~/Library/LaunchAgents/com.blitzpi.bridge.plist`). It runs `blitzpi bridge start` and nothing else.

- Linux logs: `journalctl --user -u blitzpi-bridge -f`
- On a headless box you may need `loginctl enable-linger $USER` so the unit runs without you logged in.
- macOS logs: `log show --predicate 'process == "blitzpi"' --last 10m`
- Remove it: `blitzpi bridge uninstall-service`

### 5. Say hello

Mention the bot in the bound channel. It opens a thread for its working notes and posts the answer in the channel.

---

## Using it

| In chat | What happens |
|---|---|
| `@BlitzPi <request>` | Runs it in the bound project |
| a second mention while it is working | Queued as a follow-up, or steers the current run if you are in its thread |
| `stop` / `cancel` | Aborts the current run |
| `new` / `clear` / `reset` | Starts a fresh session (new context) |
| `status` | Project, state, session, model |

From the terminal:

```
blitzpi bridge status        # what a conversation is doing
blitzpi bridge projects      # every bound conversation
blitzpi bridge post "…"      # post into the bound conversation
blitzpi bridge run "…"       # one request, in this terminal, no chat platform
blitzpi bridge model         # show or switch the session's model
blitzpi bridge unbind discord:CHANNEL_ID
blitzpi bridge shutdown
```

## Per-conversation settings

Set at `bind` time, changeable by re-binding:

| Flag | Meaning |
|---|---|
| `--trigger mentions` (default) | Only responds when mentioned |
| `--trigger all` | Responds to every message — use only in a channel dedicated to it |
| `--trigger operators` | Like `mentions`, and silent for non-operators rather than refusing out loud |
| `--activity full` (default) | Streams thinking and tool activity into the thread |
| `--activity tools` | Tool activity only, no thinking |
| `--activity quiet` | Just the answer |
| `--context N` | How many recent messages are included as context (default 5) |
| `--operator ID` | Repeatable. **With none set, everyone in the conversation is an operator** — set at least one. |

## Behaviour worth knowing

- **Children are lazy and idle-stopped.** No agent process is started until a conversation is actually used, and
  an idle one exits. Two conversations never share an agent.
- **Long output is paced**, chunked to the platform's message limit rather than edited in place.
- **A transient model error (429) retries automatically**; a real error is reported as an error, not as "done".
- **Compaction is announced** in the thread so a suddenly shorter memory is not a mystery.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Bot ignores mentions | Message Content Intent not enabled, or the conversation is not bound |
| "only operators can ask BlitzPi to work here" | Your user ID is not in `--operator` for that conversation |
| "This conversation is not bound to a project" | Bind it, or you unbound it |
| Nothing after a reboot | The daemon was hand-started; use `blitzpi bridge install-service` |
| Replies stop mid-run | Check `journalctl --user -u blitzpi-bridge -f`; the child may have crashed and been restarted |
