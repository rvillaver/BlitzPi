/** `channel_post` — from inside a bridge-hosted session, post a line into the conversation that owns this run.
 *  Registered only when the daemon set BLITZ_BRIDGE_SOCKET; gated by access profiles like any tool. Not an MCP server. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bridgeCall } from "../bridge/socket";

export function setupChannelPostTool(pi: ExtensionAPI): void {
  const socket = process.env.BLITZ_BRIDGE_SOCKET; const conv = process.env.BLITZ_BRIDGE_CONV;
  if (!socket || !conv) return;
  pi.registerTool({
    name: "channel_post",
    label: "Post to channel",
    description: "Post a short status line into the chat conversation this run belongs to (the humans there see it immediately). Use for progress worth announcing; the final answer is posted automatically.",
    parameters: Type.Object({ text: Type.String({ description: "Plain text, one or two lines" }) }),
    async execute(_id, params) {
      await bridgeCall(socket, "post", { conv, text: String(params.text).slice(0, 1800) }, 30_000);
      return { content: [{ type: "text", text: "Posted." }], details: { conv } };
    },
  });
}
